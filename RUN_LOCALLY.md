# Running CNC Import Tracker Locally

## Prerequisites

1. **Node.js** - Version 20+ recommended (uses ESM modules)
2. **npm** - Comes with Node.js
3. **PostgreSQL Database** - The app uses PostgreSQL (Neon-compatible)
4. **Python 3** - Required for Excel template exports (uses `openpyxl` and `fonttools`)

## Environment Variables Required

Create a `.env` file in the project root with these values:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Full PostgreSQL connection string |
| `PGHOST` | PostgreSQL host |
| `PGPORT` | PostgreSQL port |
| `PGUSER` | PostgreSQL username |
| `PGPASSWORD` | PostgreSQL password |
| `PGDATABASE` | PostgreSQL database name |
| `SESSION_SECRET` | Secret for session encryption |
| `ANTHROPIC_API_KEY` | For AI document analysis features |
| `ADOBE_PDF_CLIENT_SECRET` | For PDF generation (optional feature) |

## Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install all dependencies |
| `npm run db:push` | Push database schema to PostgreSQL |
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Run production build |
| `npm run check` | TypeScript type checking |

## Key Dependencies

- **Frontend**: React 18, Vite, Tailwind CSS, TanStack Query, shadcn/ui components
- **Backend**: Express.js, Drizzle ORM
- **Database**: PostgreSQL with Neon serverless driver
- **File Processing**: AWS S3 SDK, ExcelJS, jsPDF, PapaParse, xlsx
- **AI Integration**: Anthropic SDK (Claude)

## Quick Start Steps

1. Clone the repository
2. Run `npm install`
3. Set up PostgreSQL and configure environment variables in `.env`
4. Run `npm run db:push` to create database tables
5. Run `npm run dev` to start the app (serves on port 5000)
