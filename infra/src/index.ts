import { AppComponent } from './app.ts';
import { APPS } from './model.ts';

/**
 * The platform: every app, each with its environments.
 *
 * What exists once whatever the app — the folder tree, the central project, the identity pools,
 * the sign-in — is created by the modules those components are built from.
 *
 * Nothing is exported. No other stack or program reads this one's outputs: an app is told what it
 * needs through its ESC environment and its repository's variables, and the deploy workflow reads
 * the model directly.
 */
for (const app of APPS) {
  new AppComponent(app);
}
