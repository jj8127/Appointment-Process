# Deployment Guide

## 1. Admin Web (Next.js)
**Vercel Project:** `admin_web`
**Source Directory:** `web/`
**Framework:** Next.js

### Deployment Command
```bash
# Link to admin_web if not linked
vercel link --project admin_web

# Deploy root (Vercel detects web/ folder based on project settings)
vercel deploy --prod
```
*Note: Ensure `.vercelignore` excludes `node_modules` and `dist`.*

---

## 2. FC Onboarding App (Expo Web)
**Vercel Project:** `appointmentprocess`
**Source:** `app/` (exported to `dist` or `dist/web`)
**Framework:** React Native Web (Expo)

### Deployment Command
```bash
# 1. Build static export
npx expo export -p web

# 2. Ensure vercel.json exists in dist/web to disable cloud build
# (See dist/web/vercel.json content: { "buildCommand": null, ... })

# 3. Link to appointmentprocess
vercel link --project appointmentprocess

# 4. Deploy the static directory
vercel deploy dist/web --prod
```
