#!/bin/bash

# ======================================================================
# Craigslist Antique Scraper TypeScript Fix Script
# ======================================================================
# This script fixes the TypeScript compilation and runtime errors
# in the Craigslist Antique Scraper project.
#
# Usage:
#   chmod +x fix-typescript.sh
#   ./fix-typescript.sh
# ======================================================================

set -e  # Exit immediately if a command exits with a non-zero status

# Text formatting
BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Helper functions
print_step() {
    echo -e "${BOLD}${BLUE}[STEP]${NC} $1"
}

print_success() {
    echo -e "${BOLD}${GREEN}[SUCCESS]${NC} $1"
}

print_info() {
    echo -e "${BOLD}${YELLOW}[INFO]${NC} $1"
}

# ======================================================================
# Fix 1: Update tsconfig.json to include DOM library
# ======================================================================
print_step "Updating tsconfig.json to include DOM library..."

# Create a temporary file
cat > tsconfig.json.new << EOF
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "lib": ["ES2021", "DOM"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true,
    "declaration": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "typeRoots": ["./node_modules/@types", "./types"],
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "**/*.test.ts", "dist"]
}
EOF

# Replace the original file
mv tsconfig.json.new tsconfig.json
print_success "Updated tsconfig.json"

# ======================================================================
# Fix 2: Update package.json to use p-queue@6.x (CommonJS version)
# ======================================================================
print_step "Updating package.json to use p-queue@6.6.2 (CommonJS version)..."

# Create a temporary file
cat > package.json.new << EOF
{
  "name": "craigslist-antique-scraper",
  "version": "1.0.0",
  "description": "Advanced scraper for Craigslist antique listings with OpenAI integration for item analysis",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "lint": "eslint 'src/**/*.ts'",
    "test": "jest",
    "watch": "nodemon --watch 'src/**/*.ts' --exec 'ts-node' src/index.ts"
  },
  "engines": {
    "node": ">=16.0.0"
  },
  "author": "AI Engineer",
  "license": "MIT",
  "dependencies": {
    "axios": "^1.6.2",
    "openai": "^4.20.1",
    "p-queue": "^6.6.2",
    "puppeteer": "^21.5.2",
    "sqlite": "^5.1.1",
    "sqlite3": "^5.1.6",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "@types/jest": "^29.5.10",
    "@types/node": "^20.10.0",
    "@types/uuid": "^9.0.7",
    "@typescript-eslint/eslint-plugin": "^6.12.0",
    "@typescript-eslint/parser": "^6.12.0",
    "eslint": "^8.54.0",
    "jest": "^29.7.0",
    "nodemon": "^3.0.1",
    "ts-jest": "^29.1.1",
    "ts-node": "^10.9.1",
    "typescript": "^5.3.2"
  }
}
EOF

# Replace the original file
mv package.json.new package.json
print_success "Updated package.json"

# ======================================================================
# Fix 3: Update openaiService.ts to fix queue.add() return type
# ======================================================================
print_step "Fixing openaiService.ts queue.add() return type issue..."

# Check if file exists
if [ ! -f "src/ai/openaiService.ts" ]; then
    print_info "src/ai/openaiService.ts not found. Skipping this fix."
else
    # Make a backup
    cp src/ai/openaiService.ts src/ai/openaiService.ts.bak
    
    # Replace the problematic line
    sed -i.tmp '
    /return await this.queue.add(() => this.performAnalysis(listing));/c\
      return await this.queue.add(async () => this.performAnalysis(listing));
    ' src/ai/openaiService.ts
    
    # Remove temporary file
    rm -f src/ai/openaiService.ts.tmp
    print_success "Fixed openaiService.ts"
fi

# ======================================================================
# Fix 4: Update config.ts to fix index signature and accessor issues
# ======================================================================
print_step "Fixing config.ts accessor and index signature issues..."

# Check if file exists
if [ ! -f "src/utils/config.ts" ]; then
    print_info "src/utils/config.ts not found. Skipping this fix."
else
    # Make a backup
    cp src/utils/config.ts src/utils/config.ts.bak
    
    # Fix the public index signature issue
    sed -i.tmp '
    /public \[key: string\]: any/c\
  [key: string]: any
    ' src/utils/config.ts
    
    # Fix the config property access issue
    sed -i.tmp2 '
    /return target.config\[prop\];/c\
    // Access the config property via a getter method that we add to the class\
    return target.getConfig(prop);
    ' src/utils/config.ts
    
    # Add a getConfig method to the class
    sed -i.tmp3 '
    /public get \[Symbol.toStringTag\](): string {/i\
  /**\
   * Getter method for accessing config properties\
   * @param prop Property to access\
   * @returns Value of the property\
   */\
  public getConfig(prop: string): any {\
    return this.config[prop];\
  }\

    ' src/utils/config.ts
    
    # Remove temporary files
    rm -f src/utils/config.ts.tmp src/utils/config.ts.tmp2 src/utils/config.ts.tmp3
    print_success "Fixed config.ts"
fi

# ======================================================================
# Fix 5: Add explicit types to scraper.ts parameters
# ======================================================================
print_step "Fixing implicit any types in craigslistScraper.ts..."

# Check if file exists
if [ ! -f "src/scraper/craigslistScraper.ts" ]; then
    print_info "src/scraper/craigslistScraper.ts not found. Skipping this fix."
else
    # Make a backup
    cp src/scraper/craigslistScraper.ts src/scraper/craigslistScraper.ts.bak
    
    # Fix implicit any in thumb parameter
    sed -i.tmp '
    /thumbs.forEach(thumb => {/c\
        thumbs.forEach((thumb: Element) => {
    ' src/scraper/craigslistScraper.ts
    
    # Fix implicit any in group parameter
    sed -i.tmp2 '
    /attrGroups.forEach(group => {/c\
        attrGroups.forEach((group: Element) => {
    ' src/scraper/craigslistScraper.ts
    
    # Fix implicit any in span parameter
    sed -i.tmp3 '
    /spans.forEach(span => {/c\
          spans.forEach((span: Element) => {
    ' src/scraper/craigslistScraper.ts
    
    # Fix implicit any in s parameter
    sed -i.tmp4 '
    /const \[key, value\] = text.split(':').map(s => s.trim());/c\
              const [key, value] = text.split(':').map((s: string) => s.trim());
    ' src/scraper/craigslistScraper.ts
    
    # Remove temporary files
    rm -f src/scraper/craigslistScraper.ts.tmp src/scraper/craigslistScraper.ts.tmp2 src/scraper/craigslistScraper.ts.tmp3 src/scraper/craigslistScraper.ts.tmp4
    print_success "Fixed craigslistScraper.ts"
fi

# ======================================================================
# Reinstall dependencies
# ======================================================================
print_step "Reinstalling dependencies..."
npm install

# ======================================================================
# Build the project
# ======================================================================
print_step "Building the project..."
npm run build

print_success "All fixes applied!"
print_info "You can now run the project with: npm start"
