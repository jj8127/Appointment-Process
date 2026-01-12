# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FC Onboarding App** - Cross-platform (iOS/Android/Web) onboarding application for insurance agents (FC: Financial Consultant) at Garam branch. The system manages the complete appointment workflow from registration through document submission to final appointment approval.

**Key Users:**
- **FC (Financial Consultants)**: New insurance agents going through the onboarding process
- **Admin/Manager**: Staff who manage and approve the onboarding steps

## Architecture

This is a **dual-platform monorepo**:

### 1. Mobile App (Expo + React Native)
- **Framework**: Expo SDK 54, React 19, React Native 0.81.5
- **Routing**: Expo Router (file-based routing in `app/`)
- **Entry**: `app/_layout.tsx` → screens in `app/`
- **Auth**: Custom phone + password authentication via Supabase Edge Functions
- **Storage**: Cross-platform `safe-storage` abstraction (`lib/safe-storage.ts`)
  - Falls back from AsyncStorage → SecureStore → FileSystem → Memory
  - Separate web implementation in `lib/safe-storage.web.ts`

### 2. Admin Web (Next.js)
- **Framework**: Next.js 16 (App Router), React 19
- **UI**: Mantine UI v8, Tabler Icons
- **Auth**: Supabase SSR (`@supabase/ssr`)
- **Location**: `web/src/app/` directory
- **Separate deployment**: Vercel project "admin_web"

### 3. Backend
- **Database**: Supabase Postgres
- **Edge Functions**: 11 functions in `supabase/functions/` for auth, OTP, identity encryption
- **Storage**: `fc-documents` bucket for document uploads
- **Schema**: `supabase/schema.sql` defines tables, RLS policies, and storage buckets

### Shared Dependencies
- **State**: TanStack React Query v5
- **Forms**: React Hook Form + Zod validation
- **Database Client**: `@supabase/supabase-js`

## Development Commands

### Mobile App
```bash
# Install dependencies
npm install

# Start Expo development server
npm start

# Run on specific platforms
npx expo run:android
npx expo run:ios

# Test on iOS with Expo Go (QR code scan)
npx expo start  # Switch to Expo Go mode

# Clean rebuild with custom icon
npx expo prebuild --clean && npx expo run:android

# Clear app data
adb uninstall com.jj8127.fconboardingapp
```

### Admin Web
```bash
cd web
npm install
npm run dev      # Start Next.js dev server
npm run build    # Build for production
```

### Building & Deployment
```bash
# Mobile app builds (update version first!)
eas build --platform android --profile production
eas build --platform ios --profile production

# Submit latest iOS build to App Store Connect
eas submit --platform ios --latest

# Web export for mobile web
npx expo export --platform web --output-dir dist-web
npx serve -l 8081 dist-web

# Vercel deployment (see DEPLOYMENT.md)
cd web
vercel link --project admin_web
vercel deploy --prod
```

### Testing
```bash
# Testsprite E2E tests
# 1. Generate web bundle
npx expo export --platform web --output-dir dist-web
npx serve -l 8081 dist-web

# 2. Clear lock if exists
del testsprite_tests\tmp\execution.lock  # Windows
```

### Linting
```bash
npm run lint           # Root (Expo)
cd web && npm run lint # Web
```

## Database & Schema

### Key Tables
- `fc_profiles`: Main FC user profiles with appointment workflow state
  - `status`: Tracks workflow stage (draft → temp_id_issued → consent_approved → docs_approved → appointed → completed)
  - `identity_completed`: Whether FC has entered resident ID/address (unlocks full app access)
  - `phone_verified`: SMS OTP verification status
  - Unique indexes on `resident_id_hash` (hashed resident ID) and `phone`

- `fc_identity_secure`: Encrypted storage of sensitive PII
  - `resident_number_encrypted`: AES-GCM encrypted resident ID
  - `address_encrypted`: Encrypted address (separate from `fc_profiles.address`)
  - **CRITICAL**: Never store resident IDs in plaintext

- `fc_credentials`: FC login credentials (password hashes with salt)
- `admin_accounts`, `manager_accounts`: Staff login credentials
- `profiles`: Links auth.users to roles (admin/fc/manager)

### Authentication Flow
1. **Signup**: `request-signup-otp` → `verify-signup-otp` → `set-password` Edge Functions
2. **Login**: `login-with-password` Edge Function (phone + password → JWT)
3. **Password Reset**: `request-password-reset` → `reset-password` Edge Functions

### Apply Schema
```bash
# Run in Supabase SQL Editor or CLI
supabase db push

# Or manually execute
psql -U postgres -f supabase/schema.sql
```

### Utility Queries
See `명령어 모음집.txt` for:
- Generating password hashes: `node -e "const crypto=require('crypto')..."`
- Adding manager accounts
- Resetting passwords
- Adding FC accounts with credentials

## Key Workflows

### FC Onboarding Journey
1. **Signup** → Login screen → Basic info (affiliation/name/phone/recommender/email/carrier) → SMS OTP → Password setup
2. **Initial Login** → `home-lite` (limited access: 1:1 messaging + notices only)
3. **Identity Gate** (`apply-gate.tsx`) → Consent to start appointment process
4. **Identity Entry** (`identity.tsx`) → Enter resident ID + address → Checksum validation → Unlocks **full home** access
5. **Temp ID Issued** → Admin assigns temporary ID → FC can proceed
6. **Allowance Consent** → FC enters allowance agreement date → Admin approves
7. **Exam Registration** → FC registers for required exams (approval required before next step)
8. **Document Upload** → FC uploads required documents → Admin reviews/approves each
9. **Appointment** → Admin enters appointment batch → FC enters appointment completion date → Admin final approval
10. **Completed** → Workflow finished

### Admin Dashboard Flow
1. Login via `web/src/app/auth/page.tsx` (phone + password)
2. Dashboard at `web/src/app/dashboard/page.tsx`
3. Manage FCs: Assign temp IDs, approve dates/documents, track workflow status
4. Handle 1:1 messages and post notices

## Critical Security Rules

### Sensitive Data Handling
- **Resident IDs (주민번호)**: MUST be encrypted with AES-GCM before storage
  - Store in `fc_identity_secure.resident_number_encrypted`
  - Hash stored in `fc_profiles.resident_id_hash` for uniqueness check
  - NEVER store plaintext in any table
  - Edge Function: `store-identity` handles encryption

- **Passwords**: PBKDF2 with random salt (100,000 iterations, SHA-256)
  - Generate via Node.js crypto: See `명령어 모음집.txt`
  - Store `password_hash` + `password_salt` separately

### RLS (Row Level Security)
- All tables have RLS enabled
- `fc-documents` storage bucket: `authenticated` users only
- Edge Functions use service role key for privileged operations

### Data Deletion
- Use `delete-account` Edge Function to properly clean up FC data
- Cascading deletes configured for related tables

## File Structure Highlights

### Mobile App (`app/`)
```
app/
├── _layout.tsx              # Root layout with QueryClient, SessionProvider, notifications
├── index.tsx                # Home hub (dashboard or redirect based on identity_completed)
├── home-lite.tsx            # Limited home for FCs without identity verification
├── auth.tsx                 # Signup flow
├── login.tsx                # Login screen
├── identity.tsx             # Resident ID + address entry (unlocks full access)
├── apply-gate.tsx           # Consent gate to start appointment workflow
├── dashboard.tsx            # Admin dashboard (mobile)
├── consent.tsx              # Allowance consent date entry
├── exam-register.tsx        # Exam registration (FC)
├── exam-manage.tsx          # Exam approval (Admin)
├── docs-upload.tsx          # Document upload (FC)
├── appointment.tsx          # Appointment date entry
├── admin-messenger.tsx      # 1:1 messaging (Admin)
├── chat.tsx                 # 1:1 messaging (FC)
├── admin-notice.tsx         # Notice posting (Admin)
└── notice.tsx               # Notice viewing (FC)
```

### Admin Web (`web/src/app/`)
```
web/src/app/
├── layout.tsx               # Root with MantineProvider, QueryClient
├── page.tsx                 # Landing/login redirect
├── auth/page.tsx            # Admin login
├── dashboard/
│   ├── page.tsx             # Main admin dashboard
│   ├── exam/schedule/       # Exam scheduling
│   └── chat/[fcId]/         # 1:1 chat with FC
└── onboarding/[fcId]/       # FC detail view
```

### Shared Libraries (`lib/`)
- `supabase.ts`: Supabase client initialization (mobile)
- `safe-storage.ts`: Cross-platform storage abstraction
- `safe-storage.web.ts`: Web-specific storage (localStorage)
- `notifications.ts`: Push notification registration
- `docRules.ts`: Document validation rules

### Hooks (`hooks/`)
- `use-session.tsx`: Session management with phone-based auth (shared mobile/web)
- `use-identity-gate.ts`: Check if FC has completed identity verification
- `use-identity-status.ts`: Get identity completion status
- `useInAppUpdate.android.ts`: Android in-app updates

### Components (`components/`)
- `CompactHeader.tsx`: Shared header component
- `FcTourTooltip.tsx`: Onboarding tour tooltips
- `KeyboardAwareWrapper.tsx`: Keyboard handling for forms
- `MobileStatusToggle.tsx`: Status toggle for mobile

## Environment Variables

### Mobile App (`.env`)
```bash
EXPO_PUBLIC_SUPABASE_URL=your-supabase-url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Admin Web (`web/.env.local`)
```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # For server-side operations
```

**Note**: `EXPO_PUBLIC_` prefix exposes variables to app runtime. Never commit to repository.

## Deployment Targets

1. **Mobile (Expo)**: iOS App Store + Android Play Store via EAS
2. **Mobile Web**: Vercel project `appointmentprocess` (static export from `dist/web`)
3. **Admin Web**: Vercel project `admin_web` (from `web/`)

See `DEPLOYMENT.md` for detailed deployment steps.

## Key Patterns & Conventions

### Routing
- **Mobile**: File-based Expo Router. Dynamic routes use `[param].tsx` syntax.
- **Web**: Next.js App Router. Group routes with `(name)`, dynamic with `[param]/page.tsx`.

### State Management
- Server state: TanStack Query (`useQuery`, `useMutation`)
- Global auth: `SessionProvider` context (phone-based, no Supabase Auth session)
- Local form state: React Hook Form

### Platform-Specific Code
- Use `.android.ts`, `.ios.ts`, `.web.ts` suffixes for platform splits
- Example: `useInAppUpdate.android.ts` vs `useInAppUpdate.ts` (fallback)

### Notifications
- Mobile: Expo Notifications with channel setup (`alerts` channel)
- Web: Web Push API (service worker in `web/public/sw.js`)
- Registration: `registerPushToken` in `lib/notifications.ts`

### Date Handling
- Mobile: `@react-native-community/datetimepicker`
- Web: Mantine DatePicker (`@mantine/dates`)
- Format: Store as `date` type in Postgres, display with locale formatting

## Common Issues & Gotchas

### Android Crashes
- Native screen optimization disabled: `enableScreens(false)` in `app/_layout.tsx`
- Prevents drawing-order crashes on certain Android devices

### Storage Fallback Chain
- Mobile storage tries multiple adapters in order: AsyncStorage → SecureStore → FileSystem → Memory
- If one fails, gracefully falls back to next option

### Resident ID Validation
- Checksum validation implemented in `identity.tsx`
- Format: 6 digits (YYMMDD) + 7 digits (gender + serial + checksum)
- Never accept or store without encryption

### RLS Policies
- Supabase functions use service role key to bypass RLS
- Client-side queries respect RLS for security

### Session Management
- Custom auth (not Supabase Auth) - phone + password stored in separate tables
- JWT generated by `login-with-password` Edge Function
- Session stored in `safe-storage` as `{ role, residentId (phone), displayName }`

### Expo Router Quirks
- Use `router.replace()` instead of `router.push()` to prevent back navigation to auth screens
- `(tabs)` directory for bottom tab navigation
- `_layout.tsx` files define nested navigation structure

## Testing Strategy

See `AGENTS.md` Test Plan section for comprehensive test coverage including:
- Mobile-specific: Signup, password reset, home-lite restrictions, push notifications
- End-to-end: Complete appointment workflow from temp ID to completion
- Security: Identity encryption, access control, RLS
- Cross-platform: iOS/Android/Web compatibility

Test accounts and data setup documented in test plan.

## Additional Resources

- `README.md`: Quick start guide
- `DEPLOYMENT.md`: Deployment procedures for mobile + web
- `AGENTS.md`: Detailed project context, flows, and test plan
- `명령어 모음집.txt`: Korean command reference with utility scripts
- `흐름도.txt`: Korean workflow diagrams
