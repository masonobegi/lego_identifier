# Brick ID

A React Native (Expo) app for identifying LEGO parts, tracking your collection, and finding which sets you can build.

![icon](assets/icon.png)

## Features

| Feature | Description |
|---|---|
| **Part Finder** | Photograph any LEGO piece → see every set it appears in |
| **Set Checker** | Pick a set → scan your pieces → see what matches |
| **Multi-Part Scanner** | Grid split or sequential scan → ranked set matches |
| **Collection Tracking** | Build an inventory of every piece you own |
| **Set Progress** | Track completion % for sets you want to build |
| **Can Build** | See which sets you can build from your current parts |
| **Barcode Scanner** | Scan the barcode on a LEGO box to track it instantly |
| **BrickLink Export** | Export missing parts as a BrickLink Wanted List XML |
| **Scan History** | Last 20 scans saved, tap to re-open results |

## APIs Used

| API | Purpose | Key Required |
|---|---|---|
| [Brickognize](https://brickognize.com) | Part identification from photos | No (free, open) |
| [Rebrickable API v3](https://rebrickable.com/api/) | Set & part data, inventories | Yes (free) |

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/masonobegi/lego_identifier.git
cd lego_identifier
npm install --legacy-peer-deps
```

### 2. Get a Rebrickable API key

1. Create a free account at [rebrickable.com](https://rebrickable.com)
2. Go to **Settings → API**
3. Copy your API key

You can enter your key directly in the app on first launch (Onboarding screen), or set it in a `.env` file:

```bash
cp .env.example .env
# Edit .env and paste your key:
# EXPO_PUBLIC_REBRICKABLE_KEY=your_key_here
```

### 3. Run in Expo Go

```bash
npx expo start
```

Scan the QR code with **Expo Go** on your phone ([iOS](https://apps.apple.com/app/expo-go/id982107779) / [Android](https://play.google.com/store/apps/details?id=host.exp.exponent)).

## Building for Device

This project uses [EAS Build](https://docs.expo.dev/build/introduction/). Install the CLI first:

```bash
npm install -g eas-cli
eas login
```

Then link your project:

```bash
eas init
# This will set your projectId in app.json
```

### Android (APK for testing)

```bash
eas build --platform android --profile preview
```

Downloads a `.apk` you can install directly on any Android device.

### iOS (requires Mac + Apple Developer account)

```bash
# Simulator build (no Apple account needed)
eas build --platform ios --profile development

# TestFlight build (requires Apple Developer $99/yr)
eas build --platform ios --profile preview
```

### Production builds

```bash
eas build --platform all --profile production
```

## Project Structure

```
src/
  screens/         # One file per screen
  services/        # API calls, AsyncStorage, business logic
  components/      # Shared UI components (NetworkBanner)
  constants/       # Theme (colors, spacing, typography, shadows)
assets/            # App icon, splash screen
scripts/           # generate-assets.js — regenerates icon/splash PNGs
```

## Regenerating App Icons

The icon and splash are generated from code. To regenerate after changes:

```bash
node scripts/generate-assets.js
```

## Tips for Best Scan Results

- **Single part scans**: Place the piece on a **plain white or grey background** with good natural light
- **Multi-part grid scans**: Spread pieces out so they don't overlap cell boundaries
- **Sequential scans**: Fill the camera frame with one piece at a time
- Use the **flash toggle** in the camera viewfinder for dark environments

## Tech Stack

- [React Native](https://reactnative.dev) + [Expo SDK 54](https://expo.dev)
- [React Navigation](https://reactnavigation.org) (Stack)
- [expo-camera](https://docs.expo.dev/versions/latest/sdk/camera/) — camera + barcode scanning
- [expo-image-picker](https://docs.expo.dev/versions/latest/sdk/imagepicker/) — gallery access
- [expo-image-manipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/) — grid cropping
- [expo-linear-gradient](https://docs.expo.dev/versions/latest/sdk/linear-gradient/) — UI gradients
- [expo-haptics](https://docs.expo.dev/versions/latest/sdk/haptics/) — tactile feedback
- [expo-clipboard](https://docs.expo.dev/versions/latest/sdk/clipboard/) — BrickLink XML copy
- [@react-native-async-storage/async-storage](https://react-native-async-storage.github.io/async-storage/) — local data persistence
- [@react-native-community/netinfo](https://github.com/react-native-netinfo/react-native-netinfo) — network status
- [axios](https://axios-http.com) — HTTP client

## License

MIT
