// src/index.ts
/**
 * Craigslist Antique Scraper and OpenAI Analyzer
 * 
 * This application systematically collects antique listings from Craigslist NYC,
 * stores the data in a structured SQLite database, and enriches each entry with
 * AI-powered analysis for valuation, authenticity assessment, and historical context.
 * 
 * Architecture follows a modular design with clear separation of concerns:
 * - Scraping: Puppeteer-based headless browser automation
 * - Storage: SQLite3 with prepared statements for data integrity
 * - Analysis: OpenAI API integration with rate limiting and error handling
 * - Image management: Concurrent downloads with proper resource management
 * 
 * @author AI Engineer
 * @version 1.0.0
 */

import path from 'path';
import fs from 'fs';
import { CraigslistScraper } from './scraper/craigslistScraper';
import { DatabaseService } from './database/operations';
import { OpenAIService } from './ai/openaiService';
import { Logger } from './utils/logger';
import { Config } from './utils/config';

// Global configuration
const config = new Config({
  craigslist: {
    baseUrl: 'https://newyork.craigslist.org',
    antiques: '/d/search/ata',  // NYC antiques category
    resultsPerPage: 120,      // Maximum allowed by Craigslist
    maxPages: 10,             // Limit to avoid excessive scraping
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  },
  openai: {
    model: 'gpt-4-1106-preview',
    temperature: 0.2,          // Lower temperature for more factual responses
    maxTokens: 500,
    rateLimit: {
      requestsPerMinute: 3,    // Respect API rate limits
      concurrentRequests: 1
    }
  },
  database: {
    path: path.join(__dirname, '../data/database.sqlite'),
    imageDir: path.join(__dirname, '../data/images')
  },
  scraping: {
    concurrency: 5,            // Number of concurrent page processes
    delayBetweenPages: 2000,   // Milliseconds to wait between page loads
    timeout: 30000             // Page load timeout in milliseconds
  }
});

// Ensure data directories exist
fs.mkdirSync(path.dirname(config.database.path), { recursive: true });
fs.mkdirSync(config.database.imageDir, { recursive: true });

/**
 * Main application controller orchestrating the workflow
 */
class AntiqueAnalyzer {
  private logger: Logger;
  private scraper: CraigslistScraper;
  private db: DatabaseService;
  private ai: OpenAIService;

  constructor() {
    this.logger = new Logger('AntiqueAnalyzer');
    this.db = new DatabaseService(config.database.path);
    this.scraper = new CraigslistScraper(config.craigslist, config.scraping, config.database.imageDir);
    this.ai = new OpenAIService(config.openai);
  }

  /**
   * Initialize application components in the correct sequence
   */
  public async initialize(): Promise<void> {
    this.logger.info('Initializing application');
    
    // Initialize database schema
    await this.db.initialize();
    
    // Initialize scraper (launch browser)
    await this.scraper.initialize();
    
    this.logger.info('Initialization complete');
  }

  /**
   * Execute the full workflow:
   * 1. Scrape listings
   * 2. Store in database
   * 3. Analyze with OpenAI
   * 4. Update database with analysis
   */
  public async run(): Promise<void> {
    try {
      this.logger.info('Starting antique listing collection');
      
      // Step 1: Collect listings
      const listings = await this.scraper.collectListings();
      this.logger.info(`Collected ${listings.length} listings`);
      
      // Step 2: Store listings in database
      for (const listing of listings) {
        const listingId = await this.db.saveListing(listing);
        
        // Step 3: Process each listing's images
        if (listing.imageUrls && listing.imageUrls.length > 0) {
          const downloadedImages = await this.scraper.downloadImages(listing.imageUrls, listing.id);
          
          for (const image of downloadedImages) {
            await this.db.saveImage(listingId, image);
          }
        }
        
        // Step 4: Analyze with OpenAI
        if (listingId) {
          this.logger.info(`Analyzing listing: ${listing.title}`);
          
          // Prepare prompt with listing details
          const analysis = await this.ai.analyzeAntique(listing);
          
          // Step 5: Update database with analysis
          await this.db.saveAnalysis(listingId, analysis);
        }
      }
      
      this.logger.info('Processing complete');
    } catch (error) {
      this.logger.error('Error in main process', error);
      throw error;
    }
  }

  /**
   * Properly release all resources
   */
  public async cleanup(): Promise<void> {
    this.logger.info('Cleaning up resources');
    await this.scraper.close();
    await this.db.close();
    this.logger.info('Cleanup complete');
  }
}

/**
 * Application entry point with proper error handling and resource management
 */
async function main() {
  const analyzer = new AntiqueAnalyzer();
  
  try {
    await analyzer.initialize();
    await analyzer.run();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await analyzer.cleanup();
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

export { AntiqueAnalyzer };
