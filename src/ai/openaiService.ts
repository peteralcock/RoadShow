// src/ai/openaiService.ts
/**
 * OpenAIService: Handles integration with OpenAI API for antique analysis
 * 
 * Implements robust API communication with OpenAI, providing structured prompts
 * for antique analysis and parsing responses into usable data structures.
 * Includes comprehensive error handling, rate limiting, and retry logic.
 */

import { OpenAI } from 'openai';
import PQueue from 'p-queue';
import { Logger } from '../utils/logger';
import { ListingData } from '../scraper/craigslistScraper';
import { AntiqueAnalysis } from '../database/operations';

/**
 * Service for communicating with OpenAI API
 */
export class OpenAIService {
  private openai: OpenAI;
  private logger: Logger;
  private queue: PQueue;
  
  constructor(private openaiConfig: any) {
    this.logger = new Logger('OpenAIService');
    
    // Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY, // Get API key from environment variable
    });
    
    // Queue for rate limiting API requests
    this.queue = new PQueue({
      concurrency: this.openaiConfig.rateLimit.concurrentRequests,
      intervalCap: this.openaiConfig.rateLimit.requestsPerMinute,
      interval: 60 * 1000, // 1 minute
      carryoverConcurrencyCount: true
    });
  }

  /**
   * Analyzes an antique listing using OpenAI
   * @param listing Listing data to analyze
   * @returns Structured analysis data
   */
  public async analyzeAntique(listing: ListingData): Promise<AntiqueAnalysis> {
    this.logger.info(`Analyzing antique: ${listing.title}`);
    
    try {
      // Add request to rate-limited queue
      return await this.queue.add(async () => this.performAnalysis(listing));
    } catch (error) {
      this.logger.error(`Error analyzing antique: ${listing.title}`, error);
      
      // Return a default analysis if API fails
      return this.getDefaultAnalysis();
    }
  }

  /**
   * Performs the actual OpenAI API call with exponential backoff retry
   * @param listing Listing data to analyze
   * @returns Structured analysis data
   */
  private async performAnalysis(listing: ListingData): Promise<AntiqueAnalysis> {
    // Maximum retry attempts
    const maxRetries = 3;
    
    // Retry with exponential backoff
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Construct a detailed system prompt
        const systemPrompt = this.constructSystemPrompt();
        
        // Construct a detailed user prompt with the listing information
        const userPrompt = this.constructUserPrompt(listing);
        
        // Call OpenAI API
        const response = await this.openai.chat.completions.create({
          model: this.openaiConfig.model,
          temperature: this.openaiConfig.temperature,
          max_tokens: this.openaiConfig.maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' } // Ensure structured JSON response
        });
        
        // Parse and validate the response
        const analysis = this.parseResponse(response.choices[0].message.content);
        
        this.logger.info(`Successfully analyzed: ${listing.title}`);
        return analysis;
        
      } catch (error: any) {
        // Check if this is a rate limit error
        if (error.status === 429) {
          const backoffTime = Math.pow(2, attempt) * 1000; // Exponential backoff
          this.logger.warn(`Rate limit hit, retrying in ${backoffTime}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue; // Try again
        }
        
        // For other errors, log and throw
        this.logger.error(`API error (attempt ${attempt + 1}/${maxRetries})`, error);
        
        if (attempt === maxRetries - 1) {
          throw error; // Rethrow on final attempt
        }
        
        // Backoff for non-rate-limit errors too
        const backoffTime = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
    
    // If we get here, all retries failed
    throw new Error(`Failed to analyze antique after ${maxRetries} attempts`);
  }

  /**
   * Constructs the system prompt for OpenAI
   * @returns System prompt string
   */
  private constructSystemPrompt(): string {
    return `
You are an expert antique appraiser with decades of experience in identifying, authenticating, and valuing antiques.
Your task is to analyze the provided Craigslist antique listing and provide a comprehensive assessment.

Please analyze the provided information and return a JSON object with the following fields:
1. marketValue: Estimated fair market value in USD (numeric only)
2. pricingAssessment: Whether the item is "underpriced", "overpriced", or "fair" based on the listing price
3. pricingConfidence: Your confidence in the pricing assessment (0.0-1.0)
4. authenticityScore: Likelihood that the item is authentic (0.0-1.0)
5. authenticityTips: Specific visual or descriptive markers to look for to determine authenticity
6. historicalContext: Brief historical context about this type of antique
7. additionalNotes: Any other relevant observations or recommendations

Base your analysis on the description, images, price, and any other provided information.
If critical information is missing, make reasonable inferences but note your uncertainty.

Always provide your best expert assessment even with limited information.
Your analysis will be stored in a database and used to help evaluate antique listings.
`;
  }

  /**
   * Constructs the user prompt with listing details
   * @param listing Listing data to analyze
   * @returns User prompt string
   */
  private constructUserPrompt(listing: ListingData): string {
    // Format the metadata for better readability
    const metadataString = Object.entries(listing.metadata)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    
    return `
Please analyze this Craigslist antique listing:

TITLE: ${listing.title}

PRICE: ${listing.price ? `$${listing.price}` : 'Not specified'}

LOCATION: ${listing.location}

POSTED DATE: ${listing.postedDate.toDateString()}

DESCRIPTION:
${listing.description}

ADDITIONAL ATTRIBUTES:
${metadataString}

IMAGE INFORMATION: ${listing.imageUrls.length} images are available in the listing

Based on this information, provide your expert antique analysis in JSON format.
`;
  }

  /**
   * Parses and validates the OpenAI response
   * @param responseContent Response content from OpenAI
   * @returns Structured analysis data
   */
  private parseResponse(responseContent: string | null): AntiqueAnalysis {
    if (!responseContent) {
      this.logger.error('Empty response from OpenAI');
      return this.getDefaultAnalysis();
    }
    
    try {
      // Parse JSON response
      const parsed = JSON.parse(responseContent);
      
      // Validate required fields
      const validatedAnalysis: AntiqueAnalysis = {
        marketValue: this.validateNumber(parsed.marketValue, 0),
        pricingAssessment: this.validatePricingAssessment(parsed.pricingAssessment),
        pricingConfidence: this.validateConfidence(parsed.pricingConfidence),
        authenticityScore: this.validateConfidence(parsed.authenticityScore),
        authenticityTips: this.validateString(parsed.authenticityTips, 'No specific tips provided'),
        historicalContext: this.validateString(parsed.historicalContext, 'No historical context available'),
        additionalNotes: this.validateString(parsed.additionalNotes, 'No additional notes')
      };
      
      return validatedAnalysis;
    } catch (error) {
      this.logger.error('Error parsing OpenAI response', error);
      this.logger.debug('Raw response:', responseContent);
      return this.getDefaultAnalysis();
    }
  }

  /**
   * Provides a default analysis when the API fails
   * @returns Default analysis values
   */
  private getDefaultAnalysis(): AntiqueAnalysis {
    return {
      marketValue: 0,
      pricingAssessment: 'fair',
      pricingConfidence: 0,
      authenticityScore: 0,
      authenticityTips: 'Analysis unavailable due to API error',
      historicalContext: 'Analysis unavailable due to API error',
      additionalNotes: 'Please try analyzing this item again later'
    };
  }

  /**
   * Validates a numeric value
   * @param value Value to validate
   * @param defaultValue Default value if invalid
   * @returns Validated number
   */
  private validateNumber(value: any, defaultValue: number): number {
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }

  /**
   * Validates a confidence score (0.0-1.0)
   * @param value Value to validate
   * @returns Validated confidence score
   */
  private validateConfidence(value: any): number {
    const num = Number(value);
    if (isNaN(num)) return 0;
    return Math.max(0, Math.min(1, num)); // Clamp between 0 and 1
  }

  /**
   * Validates a pricing assessment value
   * @param value Value to validate
   * @returns Validated pricing assessment
   */
  private validatePricingAssessment(value: any): 'underpriced' | 'overpriced' | 'fair' {
    const validValues = ['underpriced', 'overpriced', 'fair'];
    const stringValue = String(value).toLowerCase();
    
    if (validValues.includes(stringValue)) {
      return stringValue as 'underpriced' | 'overpriced' | 'fair';
    }
    
    return 'fair'; // Default value
  }

  /**
   * Validates a string value
   * @param value Value to validate
   * @param defaultValue Default value if invalid
   * @returns Validated string
   */
  private validateString(value: any, defaultValue: string): string {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    return defaultValue;
  }
}
