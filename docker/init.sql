-- Create the blockchain database if it doesn't exist
-- Note: This is handled by Docker Compose environment variables
-- This file can be used for seed data or admin user creation

-- Create admin role if needed
-- CREATE ROLE blockchain_admin WITH LOGIN PASSWORD 'admin_password';
-- GRANT ALL PRIVILEGES ON DATABASE blockchain TO blockchain_admin;

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create schemas
CREATE SCHEMA IF NOT EXISTS public;

-- Set default permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres; 