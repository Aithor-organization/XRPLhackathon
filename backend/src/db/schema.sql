-- AgentTrust Database Schema
-- Date: 2025-09-20
-- Database: SQLite

-- 1. Users table
CREATE TABLE users (
    wallet_address TEXT PRIMARY KEY,
    user_type TEXT CHECK(user_type IN ('developer', 'buyer', 'both')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    total_sales INTEGER DEFAULT 0,
    total_purchases INTEGER DEFAULT 0,
    reputation_score DECIMAL(3,2) DEFAULT 0.00
);

-- 2. AI Agents table
CREATE TABLE ai_agents (
    agent_id TEXT PRIMARY KEY,
    nft_id TEXT UNIQUE NOT NULL,
    wallet_address TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    price_xrp DECIMAL(10,2) NOT NULL,
    image_url TEXT,
    ipfs_hash TEXT UNIQUE NOT NULL,
    credential_type TEXT UNIQUE NOT NULL,
    did_id TEXT UNIQUE, -- DID ID reference (not the document itself)
    did_document TEXT, -- Cache of DID document for quick access (optional)
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_sales INTEGER DEFAULT 0,
    average_rating DECIMAL(2,1) DEFAULT 0.0,
    FOREIGN KEY (wallet_address) REFERENCES users(wallet_address)
);

-- 3. Licenses table
CREATE TABLE licenses (
    license_id TEXT PRIMARY KEY,
    credential_id TEXT UNIQUE NOT NULL,
    agent_id TEXT NOT NULL,
    buyer_wallet TEXT NOT NULL,
    seller_wallet TEXT NOT NULL,
    transaction_hash TEXT UNIQUE NOT NULL,
    price_paid DECIMAL(10,2) NOT NULL,
    platform_fee DECIMAL(10,2) NOT NULL,
    seller_revenue DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'active',
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES ai_agents(agent_id),
    FOREIGN KEY (buyer_wallet) REFERENCES users(wallet_address),
    FOREIGN KEY (seller_wallet) REFERENCES users(wallet_address)
);

-- 4. Transactions table
CREATE TABLE transactions (
    transaction_id TEXT PRIMARY KEY,
    batch_hash TEXT,
    license_id TEXT,
    transaction_type TEXT NOT NULL,
    from_wallet TEXT NOT NULL,
    to_wallet TEXT NOT NULL,
    amount_xrp DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    FOREIGN KEY (license_id) REFERENCES licenses(license_id)
);

-- 5. Reviews table
CREATE TABLE reviews (
    review_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    license_id TEXT NOT NULL,
    reviewer_wallet TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT,
    rep_token_id TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES ai_agents(agent_id),
    FOREIGN KEY (license_id) REFERENCES licenses(license_id),
    FOREIGN KEY (reviewer_wallet) REFERENCES users(wallet_address),
    UNIQUE(license_id) -- One review per purchase
);

-- 6. REP Tokens table
CREATE TABLE rep_tokens (
    token_id TEXT PRIMARY KEY,
    nft_id TEXT UNIQUE NOT NULL,
    review_id TEXT NOT NULL,
    issuer_wallet TEXT NOT NULL,
    recipient_wallet TEXT NOT NULL,
    rating_value INTEGER NOT NULL,
    minted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (review_id) REFERENCES reviews(review_id)
);

-- 7. Download Tokens table
CREATE TABLE download_tokens (
    token TEXT PRIMARY KEY,
    license_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    buyer_wallet TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    download_count INTEGER DEFAULT 0,
    ip_address TEXT,
    FOREIGN KEY (license_id) REFERENCES licenses(license_id),
    FOREIGN KEY (agent_id) REFERENCES ai_agents(agent_id)
);

-- 8. Agent Categories table
CREATE TABLE agent_categories (
    category_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    icon_url TEXT,
    sort_order INTEGER DEFAULT 0
);

-- Indexes for Performance
-- User queries
CREATE INDEX idx_users_type ON users(user_type);

-- Agent queries
CREATE INDEX idx_agents_wallet ON ai_agents(wallet_address);
CREATE INDEX idx_agents_category ON ai_agents(category);
CREATE INDEX idx_agents_status ON ai_agents(status);
CREATE INDEX idx_agents_created ON ai_agents(created_at DESC);
CREATE INDEX idx_agents_did ON ai_agents(did_id);

-- License queries
CREATE INDEX idx_licenses_buyer ON licenses(buyer_wallet);
CREATE INDEX idx_licenses_seller ON licenses(seller_wallet);
CREATE INDEX idx_licenses_agent ON licenses(agent_id);

-- Transaction queries
CREATE INDEX idx_transactions_batch ON transactions(batch_hash);
CREATE INDEX idx_transactions_status ON transactions(status);

-- Review queries
CREATE INDEX idx_reviews_agent ON reviews(agent_id);
CREATE INDEX idx_reviews_reviewer ON reviews(reviewer_wallet);

-- Download token queries
CREATE INDEX idx_downloads_expires ON download_tokens(expires_at);
CREATE INDEX idx_downloads_buyer ON download_tokens(buyer_wallet);

-- Seed data for agent categories
INSERT INTO agent_categories (name, display_name, sort_order) VALUES
('popular', 'Popular', 1),
('new', 'New', 2),
('nlp', 'NLP Models', 3),
('computer_vision', 'Computer Vision', 4),
('reinforcement', 'Reinforcement Learning', 5);