# System Architecture

## Overview

This is a full-stack web application built with a React frontend and Node.js/Express backend. The application appears to be a logistics or import/export management system with features for tracking procedures, expenses, invoices, payments, and documents. It uses a PostgreSQL database with Drizzle ORM for data persistence and Replit Object Storage for file storage.

## System Architecture

### Technology Stack

- **Frontend**: React with TypeScript, using various UI components from Radix UI
- **Backend**: Node.js with Express
- **Database**: PostgreSQL with Drizzle ORM
- **File Storage**: Replit Object Storage
- **Deployment**: Replit-based deployment

### Architecture Pattern

The application follows a client-server architecture with:

1. **Client**: Single-page application (SPA) built with React
2. **Server**: Express.js REST API
3. **Database**: PostgreSQL for structured data
4. **Object Storage**: Replit Object Storage for document storage

## Key Components

### Frontend Components

1. **UI Framework**: The application uses a custom UI component library built on top of Radix UI primitives, following a design system similar to Shadcn UI.

2. **Pages**: The application includes several key pages:
   - Login page
   - Dashboard
   - Procedures management
   - Expenses tracking
   - Payments handling
   - Analytics and reporting

3. **State Management**: Uses React Query for server state management and data fetching.

### Backend Components

1. **API Server**: Express.js server that provides REST endpoints for the frontend.

2. **Storage Layer**: Abstraction over database operations, encapsulated in a `DatabaseStorage` class.

3. **File Storage**: Integration with Replit Object Storage for storing and retrieving documents.

4. **Routes**: API routes organized by functionality (procedures, expenses, payments, etc.)

### Database Schema

The database schema is defined using Drizzle ORM with the following main entities:

1. **Users**: System users with role-based access control (admin, user, accountant)

2. **Procedures**: The core entity representing import/export procedures

3. **Documents**: Various documents associated with procedures

4. **Taxes**: Tax information for procedures

5. **Expenses**: Import expenses associated with procedures

6. **Payments**: Payment records for procedures

7. **Invoice Line Items**: Detailed invoice items for cost distribution

The schema includes relationships between these entities, primarily using reference fields like `procedureReference`.

## Data Flow

### Authentication Flow

1. User logs in through the `/api/auth/login` endpoint
2. Authentication status is maintained through sessions
3. Protected routes check for authenticated user before processing requests

### Procedure Management Flow

1. Users create and manage procedures through the interface
2. Procedures go through various statuses (draft, pending, approved, rejected, completed)
3. Each procedure has associated documents, expenses, and payments

### Financial Management Flow

1. Expenses are recorded and categorized
2. Service invoices can be created and associated with procedures
3. Payments are tracked
4. The system calculates financial summaries with totals and balances

### Document Management Flow

1. Documents are uploaded through the UI
2. Files are stored in Replit Object Storage
3. Document metadata is stored in the database for tracking and retrieval

## External Dependencies

### UI Components

- Radix UI: Provides accessible UI primitives
- Recharts: For data visualization in analytics

### Core Dependencies

- Drizzle ORM: Database ORM for PostgreSQL
- AWS SDK: Used for S3-compatible object storage operations
- Zod: Schema validation for forms and API inputs
- React Query: Data fetching and server state management
- React Hook Form: Form management

### Database

- PostgreSQL: Primary database (via Neon Database serverless)
- Drizzle Kit: Database migration and schema management

### Storage

- Replit Object Storage: For document storage
- AWS S3 SDK: Compatible interface for Replit Object Storage

## Deployment Strategy

The application is configured for deployment on Replit with:

1. **Development Mode**:
   - Uses `npm run dev` command
   - Runs both frontend and backend in development mode

2. **Production Build**:
   - Frontend: Built with Vite (`npm run build`)
   - Backend: Bundled with esbuild
   - Combined into a single distributable

3. **Deployment Target**:
   - Configured for "autoscale" deployment on Replit
   - Exposes port 5000 internally, mapped to port 80 externally

4. **Database Provisioning**:
   - Uses Neon PostgreSQL (serverless PostgreSQL)
   - Connection via environment variables

The configuration in `.replit` and `replit.nix` files indicates this is a Replit-native project designed to run within that ecosystem.

## Security Considerations

1. **Authentication**: Basic authentication mechanism implemented
2. **Authorization**: Role-based access control (admin, user, accountant roles)
3. **File Validation**: File uploads are validated for type and size
4. **Data Validation**: Input validation using Zod schemas

## Development Patterns

1. **Database Migrations**: Uses Drizzle Kit for schema migrations
2. **Type Safety**: TypeScript throughout both frontend and backend
3. **Component Reusability**: Shared UI component library
4. **API Abstraction**: Consistent patterns for API requests and responses