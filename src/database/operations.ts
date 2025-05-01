// src/database/operations.ts
/**
 * DatabaseService: Handles all database operations for the application
 * 
 * Implements robust SQLite3 operations with prepared statements, transaction support,
 * and comprehensive error handling. Maintains referential integrity and provides
 * optimized query patterns for efficient data access.
 */

import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { Logger } from '../utils/logger';
import { ListingData, ImageData } from '../scraper/craigslistScraper';

/**
 * Interface for OpenAI analysis results
 */
export interface AntiqueAnalysis {
  marketValue: number;
  pricingAssessment: 'underpriced' | 'overpriced' | 'fair';
  pricingConfidence: number;
  authenticityScore: number;
  authenticityTips: string;
  historicalContext: string;
  additionalNotes: string;
}

/**
 * DatabaseService provides a clean interface for all database operations
 */
export class DatabaseService {
  private db: Database | null = null;
  private logger: Logger;
  
  constructor(private dbPath: string) {
    this.logger = new Logger('DatabaseService');
  }

  /**
   * Initialize the database connection and schema
   */
  public async initialize(): Promise<void> {
    this.logger.info(`Initializing database at ${this.dbPath}`);
    
    try {
      // Open database with promises API
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });
      
      // Enable foreign keys for referential integrity
      await this.db.run('PRAGMA foreign_keys = ON');
      
      // Create tables if they don't exist
      await this.createTables();
      
      this.logger.info('Database initialized successfully');
    } catch (error) {
      this.logger.error('Error initializing database', error);
      throw error;
    }
  }

  /**
   * Create database schema tables
   */
  private async createTables(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    // Use a transaction to ensure schema integrity
    await this.db.exec('BEGIN TRANSACTION');
    
    try {
      // Listings table
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS listings (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          price REAL,
          description TEXT,
          location TEXT,
          posted_date TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          metadata TEXT
        )
      `);
      
      // Images table with foreign key constraint
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS images (
          id TEXT PRIMARY KEY,
          listing_id TEXT NOT NULL,
          filename TEXT NOT NULL,
          original_url TEXT NOT NULL,
          local_path TEXT NOT NULL,
          content_type TEXT,
          size INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (listing_id) REFERENCES listings (id) ON DELETE CASCADE
        )
      `);
      
      // Analysis table with foreign key constraint
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS analyses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          listing_id TEXT NOT NULL UNIQUE,
          market_value REAL,
          pricing_assessment TEXT,
          pricing_confidence REAL,
          authenticity_score REAL,
          authenticity_tips TEXT,
          historical_context TEXT,
          additional_notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (listing_id) REFERENCES listings (id) ON DELETE CASCADE
        )
      `);
      
      // Create indices for performance
      await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_listings_posted_date ON listings (posted_date);
        CREATE INDEX IF NOT EXISTS idx_images_listing_id ON images (listing_id);
        CREATE INDEX IF NOT EXISTS idx_analyses_listing_id ON analyses (listing_id);
      `);
      
      await this.db.exec('COMMIT');
    } catch (error) {
      await this.db.exec('ROLLBACK');
      this.logger.error('Error creating tables', error);
      throw error;
    }
  }

  /**
   * Save a listing to the database
   * @param listing Listing data to save
   * @returns ID of the saved listing
   */
  public async saveListing(listing: ListingData): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    this.logger.info(`Saving listing: ${listing.title}`);
    
    try {
      // Convert metadata object to JSON string
      const metadataJson = JSON.stringify(listing.metadata);
      
      // Format date for SQLite
      const postedDate = listing.postedDate.toISOString();
      
      // Use prepared statement for safety
      const result = await this.db.run(
        `INSERT OR REPLACE INTO listings 
         (id, url, title, price, description, location, posted_date, metadata, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          listing.id,
          listing.url,
          listing.title,
          listing.price,
          listing.description,
          listing.location,
          postedDate,
          metadataJson
        ]
      );
      
      // Return the listing ID for reference
      return listing.id;
    } catch (error) {
      this.logger.error(`Error saving listing: ${listing.title}`, error);
      throw error;
    }
  }

  /**
   * Save an image to the database
   * @param listingId ID of the associated listing
   * @param image Image data to save
   * @returns ID of the saved image
   */
  public async saveImage(listingId: string, image: ImageData): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    try {
      await this.db.run(
        `INSERT OR REPLACE INTO images 
         (id, listing_id, filename, original_url, local_path, content_type, size) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          image.id,
          listingId,
          image.filename,
          image.originalUrl,
          image.localPath,
          image.contentType,
          image.size
        ]
      );
      
      return image.id;
    } catch (error) {
      this.logger.error(`Error saving image for listing ${listingId}`, error);
      throw error;
    }
  }

  /**
   * Save antique analysis results to the database
   * @param listingId ID of the associated listing
   * @param analysis Analysis data to save
   * @returns ID of the saved analysis
   */
  public async saveAnalysis(listingId: string, analysis: AntiqueAnalysis): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    this.logger.info(`Saving analysis for listing: ${listingId}`);
    
    try {
      const result = await this.db.run(
        `INSERT OR REPLACE INTO analyses 
         (listing_id, market_value, pricing_assessment, pricing_confidence, 
          authenticity_score, authenticity_tips, historical_context, 
          additional_notes, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          listingId,
          analysis.marketValue,
          analysis.pricingAssessment,
          analysis.pricingConfidence,
          analysis.authenticityScore,
          analysis.authenticityTips,
          analysis.historicalContext,
          analysis.additionalNotes
        ]
      );
      
      return result.lastID!;
    } catch (error) {
      this.logger.error(`Error saving analysis for listing ${listingId}`, error);
      throw error;
    }
  }

  /**
   * Get a listing by ID with its images and analysis
   * @param listingId ID of the listing to retrieve
   * @returns Complete listing data with images and analysis
   */
  public async getListingWithDetails(listingId: string): Promise<any> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    try {
      // Get the listing data
      const listing = await this.db.get(
        'SELECT * FROM listings WHERE id = ?',
        [listingId]
      );
      
      if (!listing) {
        return null;
      }
      
      // Parse metadata JSON
      if (listing.metadata) {
        listing.metadata = JSON.parse(listing.metadata);
      }
      
      // Get associated images
      const images = await this.db.all(
        'SELECT * FROM images WHERE listing_id = ?',
        [listingId]
      );
      
      // Get associated analysis
      const analysis = await this.db.get(
        'SELECT * FROM analyses WHERE listing_id = ?',
        [listingId]
      );
      
      // Combine everything
      return {
        ...listing,
        images,
        analysis
      };
    } catch (error) {
      this.logger.error(`Error retrieving listing ${listingId}`, error);
      throw error;
    }
  }

  /**
   * Get listings that match search criteria
   * @param criteria Search criteria object
   * @param limit Maximum number of results
   * @param offset Pagination offset
   * @returns Array of matching listings
   */
  public async searchListings(criteria: any, limit = 50, offset = 0): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    try {
      // Build dynamic query based on criteria
      let query = 'SELECT * FROM listings WHERE 1=1';
      const params: any[] = [];
      
      if (criteria.title) {
        query += ' AND title LIKE ?';
        params.push(`%${criteria.title}%`);
      }
      
      if (criteria.minPrice !== undefined) {
        query += ' AND price >= ?';
        params.push(criteria.minPrice);
      }
      
      if (criteria.maxPrice !== undefined) {
        query += ' AND price <= ?';
        params.push(criteria.maxPrice);
      }
      
      if (criteria.location) {
        query += ' AND location LIKE ?';
        params.push(`%${criteria.location}%`);
      }
      
      if (criteria.fromDate) {
        query += ' AND posted_date >= ?';
        params.push(criteria.fromDate);
      }
      
      // Add sorting, limit, and offset
      query += ' ORDER BY posted_date DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      
      return await this.db.all(query, params);
    } catch (error) {
      this.logger.error('Error searching listings', error);
      throw error;
    }
  }

  /**
   * Get statistics about the database
   * @returns Object with database statistics
   */
  public async getDatabaseStats(): Promise<any> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    try {
      const listingCount = await this.db.get('SELECT COUNT(*) as count FROM listings');
      const imageCount = await this.db.get('SELECT COUNT(*) as count FROM images');
      const analysisCount = await this.db.get('SELECT COUNT(*) as count FROM analyses');
      const avgPrice = await this.db.get('SELECT AVG(price) as average FROM listings WHERE price IS NOT NULL');
      const maxPrice = await this.db.get('SELECT MAX(price) as maximum FROM listings');
      const minPrice = await this.db.get('SELECT MIN(price) as minimum FROM listings WHERE price IS NOT NULL');
      
      return {
        listingCount: listingCount.count,
        imageCount: imageCount.count,
        analysisCount: analysisCount.count,
        pricing: {
          average: avgPrice.average,
          maximum: maxPrice.maximum,
          minimum: minPrice.minimum
        }
      };
    } catch (error) {
      this.logger.error('Error getting database stats', error);
      throw error;
    }
  }

  /**
   * Close the database connection
   */
  public async close(): Promise<void> {
    if (this.db) {
      this.logger.info('Closing database connection');
      await this.db.close();
      this.db = null;
    }
  }
}
