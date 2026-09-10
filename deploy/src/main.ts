import { APPS, DEPLOY_ORDER, appEnvironmentKey, hostnameFor, type App } from '../../infra/model.ts';
import { deploy } from './deploy.ts';
import { requireEnvironment } from './environment.ts';
import { smokeTest } from './smokeTest.ts';

/**
 * Deploys one app's environments, in the order they have to happen in.
 *
 * Every environment is deployed from the same commit and then asked whether it
 * serves. A failure stops the sequence where it happened, so an environment is only
 * reached once the one before it was observed working — which is the entire content of
 * the word "staging".
 *
 * This runs in the platform repository rather than the app's, and that is the point.
 * It holds a credential no app may hold, so an app must not be able to change what it
 * does with it. An app asks for this to run; it does not supply the steps.
 *
 * Which app, though, is the app's to say — it comes from the repository that called,
 * as GitHub reports it, so asking can only ever deploy the asker. The order and the
 * hostnames come from this repository's model, where an app cannot reach them.
 *
 * Nothing is undone on failure. There is no rollback here and none in Pulumi: a
 * deployment that fails partway has already made some of its changes, and the next
 * commit is what fixes it. What this prevents is not a broken environment, but a
 * broken environment being copied to the next one.
 */

/**
 * `owner/name`, as GitHub gives it. The name is the app, and the Pulumi project.
 *
 * Checked against the model rather than trusted. The identity a caller federates with
 * is already bound to its own repository, so a repository that is not an app cannot
 * get one — but a check that says so out loud fails with a sentence instead of with a
 * Pulumi error about a stack nobody has.
 */
const named = requireEnvironment('GITHUB_REPOSITORY').split('/')[1];
const app = APPS.find((candidate): candidate is App => candidate === named);

if (app === undefined) {
  throw new Error(`${named ?? 'nothing'} is not an app this repository deploys`);
}

const commit = requireEnvironment('GITHUB_SHA');

for (const environment of DEPLOY_ORDER) {
  await deploy(app, environment, commit);
  await smokeTest(
    `https://${hostnameFor({ app, environment, key: appEnvironmentKey(app, environment) })}`,
  );
}
