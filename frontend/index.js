import registerRootComponent from 'expo/src/launch/registerRootComponent';
import { initCrashReporting } from './src/services/crashReporter';
import App from './App';

// Install global error/rejection handlers before the app renders so crashes
// outside the React render tree are reported too (the error boundary only
// catches render-tree errors).
initCrashReporting();

registerRootComponent(App);
