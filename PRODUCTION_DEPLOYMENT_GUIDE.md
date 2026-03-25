# Production Deployment Guide for Morty's Driving School

## Automatic Database Initialization

The system automatically initializes the database on startup with:
- Default admin user (username: "admin", password: "DriveSchool2025!")
- Sample locations (Montreal, D.D.O., Laval)
- All required database tables and schemas

## Deployment Steps

1. **Click Deploy in Replit**
   - The system will automatically build and deploy
   - Database initialization runs on first startup

2. **Verify Admin Login**
   - Username: `admin`
   - Password: `DriveSchool2025!`

## Troubleshooting Production Login Issues

### Step 1: Verify Database Connection
Check production logs for "Database initialization completed" message.

### Step 2: Test Emergency Endpoint
If login fails, create admin user manually:

```bash
curl -X POST https://your-app.replit.app/api/admin/create-admin-user
```

### Step 3: Check User Exists
Verify admin user in production database:

```bash
curl -X GET "https://your-app.replit.app/api/admin/verify-user?username=admin"
```

### Step 4: Force User Creation (if needed)
Direct database initialization:

```bash
curl -X POST https://your-app.replit.app/api/admin/force-init-db
```

All endpoints include safety checks and detailed logging.

## Production Features

✅ **Automatic Database Setup**
- Admin user creation
- Location seeding
- Schema migration

✅ **Session Management**
- PostgreSQL session store
- Secure authentication
- Proper cookie handling

✅ **Environment Handling**
- Development and production compatibility
- Automatic environment detection
- Database URL configuration

## Login Credentials for Production

**Admin Access:**
- Username: `admin`
- Password: `DriveSchool2025!`

These credentials work in both development and production environments.

## Database Structure

The system automatically creates all required tables:
- users (authentication)
- students (student management)
- instructors (instructor profiles)
- classes (class scheduling)
- contracts (financial management)
- evaluations (performance tracking)
- locations (multi-location support)
- And 20+ additional tables for full functionality

## Support

If you encounter any login issues after deployment:
1. Check the deployment logs for database initialization messages
2. Use the emergency admin creation endpoint if needed
3. Verify the DATABASE_URL environment variable is set

The system is designed to work out-of-the-box in production with no manual setup required.