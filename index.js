// Import background task definitions BEFORE expo-router loads.
// TaskManager.defineTask must execute at the top level before any component renders,
// otherwise the OS may trigger a task that hasn't been defined yet.
import './src/tasks/config-refresh';

// Then hand off to Expo Router's default entry
import 'expo-router/entry';
