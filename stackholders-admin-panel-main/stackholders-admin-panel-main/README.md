# Stockholders Admin Panel

A secure, high-performance administrative interface for managing stockholders, dividends, and transactions. Built with React, Vite, and Supabase.

## 🚀 Tech Stack

- **Frontend**: [React](https://reactjs.org/) + [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: Plain CSS, one stylesheet per component
- **Database & Auth**: [Supabase](https://supabase.com/)
- **Internationalization**: [react-i18next](https://react.i18next.com/) (English & Arabic)
- **Server state**: [TanStack Query](https://tanstack.com/query)
- **Visualizations**: [Recharts](https://recharts.org/)
- **Animations**: [Framer Motion](https://www.framer.com/motion/)

## ✨ Key Features

- **📊 Comprehensive Dashboard**: Real-time overview of stockholder statistics and performance metrics.
- **👥 Stockholder Management**: Complete CRUD operations with advanced filtering and detail views.
- **💰 Financial Tools**: Manage dividends, track transactions, and generate reports.
- **📜 Audit Logs**: Comprehensive tracking of all administrative actions for security and transparency.
- **🌍 Bilingual Support**: Full support for LTR (English) and RTL (Arabic) layouts.
- **📂 Document Management**: Upload and manage certificates and approval documents.

## 🛠️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd stackholders-admin-panel
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   Create a `.env` file in the root directory and add your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

## 🧹 Maintenance (Keep-Alive)

To prevent the Supabase free tier from pausing due to inactivity, this project includes a **GitHub Action** that "touches" the API once every 24 hours.

- **Workflow**: `.github/workflows/keep-alive.yml`
- **Schedule**: `0 0 * * *` (Midnight UTC)
- **Required Secrets**: `SUPABASE_URL` and `SUPABASE_ANON_KEY` must be added to your GitHub Repository Secrets.

## 📦 Scripts

- `npm run dev`: Start development server.
- `npm run build`: Build for production.
- `npm run lint`: Run ESLint.
- `npm run test`: Run the Vitest suite.
- `npm run test:watch`: Run tests in watch mode.

---

Built for excellence in administrative management.
