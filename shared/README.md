# @cropsetu/shared

Code used by **both** CropSetu apps:

| App | Path | Audience |
| --- | --- | --- |
| Buyer / farmer app | `frontend/` | farmers browsing the store, AI assistant, rent, animals, farm profile |
| Seller app | `seller-app/` | sellers managing products, orders, KYC, received crop reports |

Anything imported by only one app belongs in that app, not here.

## What lives here

```
constants/   colors, khetTheme, config (API URLs, storage keys), locations, indiaLocations, categories
services/    api (axios client + auth/refresh/CSRF interceptors), socket, crashReporter
context/     AuthContext (OTP auth, token storage, idle logout), LanguageContext
i18n/        translations.js + lang/* (10 languages)
utils/       storage, validators, haptics, sounds, mediaCompressor, proofOfWork
components/  LocationPicker, CropIcons, StoreCategoryIcons, DashboardStatIcons,
             RootErrorBoundary, ui/AnimatedScreen, ui/motion
screens/     LoginScreen (OTP login — identical in both apps)
```

## How apps consume it

This is **not** an installed npm package — there is no `node_modules/@cropsetu/shared`.
Each app's `metro.config.js` maps the `@cropsetu/shared` specifier to this folder and
adds it to `watchFolders`, and resolves `react` / `react-native` / Expo modules from
the host app's own `node_modules`:

```js
import { COLORS } from '@cropsetu/shared/constants/colors';
import api from '@cropsetu/shared/services/api';
import { useLanguage } from '@cropsetu/shared/context/LanguageContext';
```

Consequences to keep in mind:

- **No dependencies of its own.** Everything in `peerDependencies` must be installed
  in *both* apps at compatible versions, or the app that lacks it fails at bundle time.
- **No app-specific imports.** Nothing here may import `app.json`, an app's `assets/`,
  or anything under an app's `src/`. Read build metadata from `expo-constants`
  (`Constants.expoConfig`) instead — see `services/crashReporter.js`.
- **Metro caches aggressively.** After editing files here, restart Metro with
  `npx expo start -c` in the consuming app if changes don't appear.

## Tests

`utils/__tests__/` runs from the buyer app's Jest config, which lists `../shared`
as a root:

```bash
cd frontend && npm test
```
