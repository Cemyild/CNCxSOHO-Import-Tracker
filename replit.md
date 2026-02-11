# CNC Import Tracker

## Overview
CNC Import Tracker is a comprehensive logistics and customs management system designed to track import procedures, expenses, taxes, and payments. It manages the full lifecycle of import shipments, from initial procedures through customs clearance, tax calculations, and final payment reconciliation, across multiple companies (ALO, AMIRI, SOHO). Key capabilities include tracking import procedures, calculating various taxes (customs, VAT, KKDF, stamp tax), managing import and service expenses, handling payment distributions, and providing analytics with PDF/Excel export.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Frameworks & Libraries**: React with TypeScript, Vite, Wouter for routing, shadcn/ui (built on Radix UI), Tailwind CSS for styling, TanStack Query for server state.
- **Design Patterns**: Page-based architecture, dashboard with expandable cards, table-based data display (sorting, filtering, pagination), form-heavy interfaces, modal dialogs, consistent status badges.
- **Key Features**: Dashboard overview, detailed import procedure tracking, unified expense entry, payment management, pre-shipment tax estimation with missing data detection and resolution (including Excel import and product/HS code matching), and analytical reports.

### Backend
- **Framework**: Node.js with Express.js (TypeScript/ESM).
- **Data Layer**: Drizzle ORM for PostgreSQL (Neon), schema-first approach (`shared/schema.ts`), transaction support.
- **Business Logic**: Financial summaries, payment distribution, Turkish customs tax calculations, invoice line item management, report generation.
- **API Patterns**: RESTful design with standard GET, POST, PUT/PATCH, DELETE endpoints.

### Data Storage
- **Primary Database**: PostgreSQL hosted on Neon, managed with Drizzle Kit migrations.
- **Core Tables**: `procedures`, `taxes`, `importExpenses`, `importServiceInvoices`, `payments`, `paymentDistributions`, `invoiceLineItems`, `products`, `hsCodes`.
- **Relationships**: Extensive foreign key relationships linking procedures to expenses, taxes, invoices, and payments.

### Authentication & Authorization
- **Method**: Session-based authentication using `express-session` with secure cookie settings.
- **Security**: HTTP-only cookies; currently no complex role-based access control.

## External Dependencies

-   **PDF Generation**: Adobe PDF Services SDK (`@adobe/pdfservices-node-sdk`) for template-based PDF reports.
-   **File Storage**: AWS S3 SDK and Replit Object Storage for file and document storage using presigned URLs.
-   **Excel Generation**: Python `openpyxl` for template-based Excel exports, preserving formatting and supporting dynamic data.
-   **Document Analysis**: Anthropic Claude Sonnet 4 via a custom API for extracting data from various PDF documents (customs declarations, import expense invoices, service invoices).
-   **Database & ORM**: Drizzle ORM (`drizzle-kit`), Neon serverless PostgreSQL (`@neondatabase/serverless`).
-   **UI Component Libraries**: Radix UI primitives, Lucide React (icons), Recharts (charts), React Hook Form with Zod resolvers.