# Craigslist Antique Scraper and Analyzer
![Screenshot](antique.jpg?raw=true "RoadShow")

An advanced application for systematically collecting antique listings from Craigslist, storing them in a structured SQLite database, and enriching each entry with AI-powered analysis for valuation, authenticity assessment, and historical context.

## Features

- **Robust Web Scraping**: Uses Puppeteer to collect antique listings from Craigslist NYC with proper rate limiting and error handling
- **Data Persistence**: Stores all listing data, images, and analysis in a SQLite3 database
- **Image Management**: Downloads and stores images from listings with proper resource management
- **AI-Powered Analysis**: Integrates with OpenAI API to analyze each antique with the following:
  - Fair market value estimation
  - Price assessment (underpriced, overpriced, or fair)
  - Authenticity evaluation
  - Tips for determining authenticity
  - Historical context and additional insights
- **Modular Architecture**: Clean separation of concerns for maintainability and extensibility
- **Resource Efficient**: Implements concurrency controls, connection pooling, and proper resource cleanup

## Architecture

The application follows a modular design with clear separation of concerns:

- **Scraping**: Puppeteer-based headless browser automation
- **Storage**: SQLite3 with prepared statements for data integrity
- **Analysis**: OpenAI API integration with rate limiting and error handling
- **Image management**: Concurrent downloads with proper resource management

## Prerequisites

- Node.js 16.x or higher
- NPM or Yarn
- OpenAI API key

## Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/craigslist-antique-scraper.git
cd craigslist-antique-scraper
```

2. Install dependencies
```bash
npm install
```

3. Create a `.env` file in the project root with your OpenAI API key:
```
OPENAI_API_KEY=your_api_key_here
```

4. Build the TypeScript code
```bash
npm run build
```

## Usage

1. Start the application:
```bash
npm start
```

The application will:
1. Initialize the database and create necessary tables
2. Launch a headless browser for scraping
3. Collect antique listings from Craigslist NYC
4. Download and store images locally
5. Analyze each listing using OpenAI
6. Store all data in the SQLite database

## Configuration

The application can be configured via environment variables or by modifying the config object in `src/index.ts`:

- **Scraping Settings**:
  - Maximum pages to scrape
  - Results per page
  - Delay between requests
  - Concurrency limits

- **OpenAI Settings**:
  - Model selection
  - Temperature
  - Maximum tokens
  - Rate limits

- **Database Settings**:
  - Database file path
  - Image storage directory

## Data Model

### Listings Table
Stores the core information about each antique listing:
- ID (UUID)
- URL
- Title
- Price
- Description
- Location
- Posted date
- Metadata (JSON)

### Images Table
Stores information about listing images:
- ID (UUID)
- Listing ID (foreign key)
- Filename
- Original URL
- Local path
- Content type
- Size

### Analyses Table
Stores AI-generated analysis for each listing:
- ID (auto-increment)
- Listing ID (foreign key)
- Market value estimation
- Pricing assessment
- Pricing confidence score
- Authenticity score
- Authenticity tips
- Historical context
- Additional notes

## License

MIT

## Disclaimer

This application is for educational purposes only. When scraping websites, always respect their terms of service and robots.txt directives. Implement appropriate rate limiting and don't overload their servers.
