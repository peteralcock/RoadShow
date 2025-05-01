// src/scraper/craigslistScraper.ts
/**
 * CraigslistScraper: Responsible for extracting antique listings from Craigslist
 * 
 * Uses Puppeteer to navigate Craigslist's antique section, extract listing data,
 * and download associated images. Implements robust error handling, rate limiting,
 * and resource management to ensure reliable operation.
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { Logger } from '../utils/logger';
import PQueue from 'p-queue';

// Convert pipeline to Promise-based API
const pipelineAsync = promisify(pipeline);

// Types for application data structures
export interface ListingData {
  id: string;
  url: string;
  title: string;
  price: number | null;
  description: string;
  location: string;
  postedDate: Date;
  imageUrls: string[];
  metadata: Record<string, any>;
}

export interface ImageData {
  id: string;
  listingId: string;
  filename: string;
  originalUrl: string;
  localPath: string;
  contentType: string;
  size: number;
}

/**
 * CraigslistScraper class with comprehensive scraping capabilities
 */
export class CraigslistScraper {
  private browser: Browser | null = null;
  private logger: Logger;
  private queue: PQueue;
  private imageQueue: PQueue;
  
  constructor(
    private craigslistConfig: any,
    private scrapingConfig: any,
    private imageDir: string
  ) {
    this.logger = new Logger('CraigslistScraper');
    
    // Queue for controlling concurrency of page scraping
    this.queue = new PQueue({
      concurrency: this.scrapingConfig.concurrency,
      intervalCap: 1, // Max tasks per interval
      interval: this.scrapingConfig.delayBetweenPages,
      carryoverConcurrencyCount: true
    });
    
    // Separate queue for image downloads
    this.imageQueue = new PQueue({
      concurrency: 10, // Higher concurrency for image downloads
      intervalCap: 20,
      interval: 10000, // 10 seconds
    });
  }

  /**
   * Initialize the scraper by launching a Puppeteer browser
   */
  public async initialize(): Promise<void> {
    this.logger.info('Initializing Puppeteer browser');
    
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1280,800'
      ],
      defaultViewport: { width: 1280, height: 800 }
    });
    
    this.logger.info('Browser initialized');
  }

  /**
   * Collects all antique listings by navigating through result pages
   * @returns Array of parsed listings
   */
  public async collectListings(): Promise<ListingData[]> {
    if (!this.browser) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }
    
    this.logger.info('Starting to collect listings');
    
    const allListings: ListingData[] = [];
    const listingUrls: Set<string> = new Set();
    
    // Start with the first page of results
    const baseSearchUrl = `${this.craigslistConfig.baseUrl}${this.craigslistConfig.antiques}`;
    
    try {
      // Get listing URLs from search results pages
      for (let pageNum = 0; pageNum < this.craigslistConfig.maxPages; pageNum++) {
        const pageUrl = pageNum === 0 
          ? baseSearchUrl 
          : `${baseSearchUrl}?s=${pageNum * this.craigslistConfig.resultsPerPage}`;
        
        this.logger.info(`Collecting listing URLs from page ${pageNum + 1}: ${pageUrl}`);
        
        const page = await this.browser.newPage();
        await this.configurePageDefaults(page);
        
        try {
          await page.goto(pageUrl, { 
            timeout: this.scrapingConfig.timeout,
            waitUntil: 'networkidle2' 
          });
          
          // Check if we've reached the end of results
          const noResults = await page.evaluate(() => {
            return document.querySelector('.alert-warning') !== null;
          });
          
          if (noResults) {
            this.logger.info('No more results available');
            await page.close();
            break;
          }
          
          // Extract listing URLs from the search results page
          const pageListingUrls = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('.result-title'));
            return links.map(link => (link as HTMLAnchorElement).href);
          });
          
          this.logger.info(`Found ${pageListingUrls.length} listings on page ${pageNum + 1}`);
          
          // Add new URLs to our set
          pageListingUrls.forEach(url => listingUrls.add(url));
          
          await page.close();
          
          // If we didn't get a full page of results, we've reached the end
          if (pageListingUrls.length < this.craigslistConfig.resultsPerPage) {
            this.logger.info('Reached last page of results');
            break;
          }
          
          // Add a small delay between pages to be respectful
          await new Promise(resolve => setTimeout(resolve, this.scrapingConfig.delayBetweenPages));
        } catch (error) {
          this.logger.error(`Error processing search results page ${pageNum + 1}`, error);
          await page.close();
        }
      }
      
      this.logger.info(`Found ${listingUrls.size} unique antique listings`);
      
      // Now process each individual listing page to extract detailed data
      const listingPromises = Array.from(listingUrls).map(url => 
        this.queue.add(() => this.scrapeListingPage(url))
      );
      
      // Wait for all listings to be processed
      const results = await Promise.allSettled(listingPromises);
      
      // Filter out rejected promises and add successful results to our listings array
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          allListings.push(result.value);
        }
      });
      
      this.logger.info(`Successfully scraped ${allListings.length} listings`);
      
      return allListings;
    } catch (error) {
      this.logger.error('Error collecting listings', error);
      throw error;
    }
  }

  /**
   * Scrapes an individual listing page to extract detailed information
   * @param url URL of the listing page
   * @returns Parsed listing data or null if unsuccessful
   */
  private async scrapeListingPage(url: string): Promise<ListingData | null> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }
    
    this.logger.info(`Scraping listing: ${url}`);
    const page = await this.browser.newPage();
    await this.configurePageDefaults(page);
    
    try {
      await page.goto(url, { 
        timeout: this.scrapingConfig.timeout,
        waitUntil: 'networkidle2' 
      });
      
      // Check if page is valid (not deleted or expired)
      const isDeleted = await page.evaluate(() => {
        return document.querySelector('.removed') !== null || 
               document.querySelector('.expired') !== null;
      });
      
      if (isDeleted) {
        this.logger.info(`Listing ${url} has been deleted or expired`);
        await page.close();
        return null;
      }
      
      // Extract all relevant data from the listing page
      const listingData = await page.evaluate(() => {
        // Helper function to safely extract text content
        const getText = (selector: string): string => {
          const element = document.querySelector(selector);
          return element ? element.textContent?.trim() || '' : '';
        };
        
        // Extract price (removing $ and commas)
        const priceText = getText('.price');
        const price = priceText ? Number(priceText.replace(/[$,]/g, '')) : null;
        
        // Extract title
        const title = getText('#titletextonly');
        
        // Extract posting date
        const dateText = getText('.date.timeago');
        const postedDate = dateText ? new Date(dateText) : new Date();
        
        // Extract location
        const location = getText('.mapaddress') || getText('.mapbox small');
        
        // Extract description
        const description = getText('#postingbody');
        
        // Extract image URLs
        const imageUrls: string[] = [];
        const thumbs = document.querySelectorAll('.gallery .thumb');
        thumbs.forEach((thumb: Element) => {
          const dataSrc = thumb.getAttribute('data-src');
          if (dataSrc) {
            // Convert thumbnail URL to full-size image URL
            const fullSizeUrl = dataSrc.replace('50x50c', '600x450');
            imageUrls.push(fullSizeUrl);
          }
        });
        
        // Extract additional metadata from attributes table
        const metadata: Record<string, string> = {};
        const attrGroups = document.querySelectorAll('.attrgroup');
        attrGroups.forEach((group: Element) => {
          const spans = group.querySelectorAll('span');
          spans.forEach((span: Element) => {
            const text = span.textContent?.trim();
            if (text && text.includes(':')) {
              const [key, value] = text.split(':').map(s => s.trim());
              metadata[key] = value;
            } else if (text) {
              metadata[text] = 'true';
            }
          });
        });
        
        return {
          title,
          price,
          description,
          location,
          postedDate: postedDate.toISOString(),
          imageUrls,
          metadata
        };
      });
      
      await page.close();
      
      // Create a unique ID for this listing
      const id = uuidv4();
      
      return {
        id,
        url,
        title: listingData.title,
        price: listingData.price,
        description: listingData.description,
        location: listingData.location,
        postedDate: new Date(listingData.postedDate),
        imageUrls: listingData.imageUrls,
        metadata: listingData.metadata
      };
    } catch (error) {
      this.logger.error(`Error scraping listing: ${url}`, error);
      await page.close();
      return null;
    }
  }

  /**
   * Downloads images for a specific listing
   * @param imageUrls Array of image URLs to download
   * @param listingId ID of the associated listing
   * @returns Array of downloaded image data
   */
  public async downloadImages(imageUrls: string[], listingId: string): Promise<ImageData[]> {
    this.logger.info(`Downloading ${imageUrls.length} images for listing ${listingId}`);
    
    const downloadPromises = imageUrls.map(url => 
      this.imageQueue.add(() => this.downloadImage(url, listingId))
    );
    
    const results = await Promise.allSettled(downloadPromises);
    
    // Filter out failed downloads
    const downloadedImages: ImageData[] = [];
    
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        downloadedImages.push(result.value);
      }
    });
    
    this.logger.info(`Successfully downloaded ${downloadedImages.length} images for listing ${listingId}`);
    
    return downloadedImages;
  }

  /**
   * Downloads a single image
   * @param url URL of the image to download
   * @param listingId ID of the associated listing
   * @returns Image data or null if download failed
   */
  private async downloadImage(url: string, listingId: string): Promise<ImageData | null> {
    const imageId = uuidv4();
    const extension = this.getFileExtension(url);
    const filename = `${listingId}_${imageId}${extension}`;
    const localPath = path.join(this.imageDir, filename);
    
    try {
      // Download image with proper HTTP headers
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': this.craigslistConfig.userAgent,
          'Referer': this.craigslistConfig.baseUrl
        },
        timeout: 30000
      });
      
      // Get content type and size
      const contentType = response.headers['content-type'] || 'image/jpeg';
      const contentLength = parseInt(response.headers['content-length'] || '0', 10);
      
      // Save the image to disk
      await pipelineAsync(
        response.data,
        fs.createWriteStream(localPath)
      );
      
      // Get actual file size
      const stats = await fs.promises.stat(localPath);
      
      return {
        id: imageId,
        listingId,
        filename,
        originalUrl: url,
        localPath,
        contentType,
        size: stats.size || contentLength
      };
    } catch (error) {
      this.logger.error(`Error downloading image ${url}`, error);
      
      // Clean up any partially downloaded file
      if (fs.existsSync(localPath)) {
        try {
          await fs.promises.unlink(localPath);
        } catch (unlinkError) {
          this.logger.error(`Error deleting partial download ${localPath}`, unlinkError);
        }
      }
      
      return null;
    }
  }

  /**
   * Configures standard page settings for Puppeteer
   * @param page Puppeteer Page object to configure
   */
  private async configurePageDefaults(page: Page): Promise<void> {
    // Set user agent
    await page.setUserAgent(this.craigslistConfig.userAgent);
    
    // Disable images and CSS to speed up loading
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
        request.abort();
      } else {
        request.continue();
      }
    });
    
    // Add error handling for page errors
    page.on('error', (error) => {
      this.logger.error('Page crashed', error);
    });
    
    // Set timeout
    page.setDefaultNavigationTimeout(this.scrapingConfig.timeout);
  }

  /**
   * Extracts file extension from URL
   * @param url URL to analyze
   * @returns File extension including dot
   */
  private getFileExtension(url: string): string {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const extension = path.extname(pathname);
    
    // If no extension is found, default to .jpg
    return extension || '.jpg';
  }

  /**
   * Closes the browser and releases resources
   */
  public async close(): Promise<void> {
    if (this.browser) {
      this.logger.info('Closing browser');
      await this.browser.close();
      this.browser = null;
    }
  }
}
