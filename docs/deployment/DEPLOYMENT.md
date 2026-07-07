# Deployment Guide

## 1. Admin Web (Next.js)
**Vercel Project:** `admin_web`
**Source Directory:** repository root, current `vercel.json` builds `web/`
**Framework:** Next.js

### Deployment Command
```bash
# Link to admin_web if not linked
vercel link --project admin_web

# Deploy from the repository root so the root vercel.json is used
vercel deploy --prod --archive=tgz
```
*Note: `.vercelignore` excludes `node_modules`, `dist`, and `dist-web*`; ignored Expo exports are not admin web source.*

---

## 2. FC Onboarding App (Expo Web)
**Vercel Project:** `appointmentprocess`
**Source:** generated Expo web export under ignored `dist/`
**Framework:** React Native Web (Expo)

`dist/` is generated output, not source. Rebuild it fresh for any intentional static web deployment and do not commit it.

### Deployment Command
```bash
# 1. Build static export
npm run build

# 2. Link to appointmentprocess only when deploying the Expo static site
vercel link --project appointmentprocess

# 3. Deploy the freshly generated static directory
vercel deploy dist --prod
```

Current repository-level Vercel config targets the admin web project, so do not use stale checked-out `dist/` as deployment evidence.
