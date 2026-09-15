import type * as github from '@pulumi/github';
import * as pulumi from '@pulumi/pulumi';
import { appDeployBinding } from './app-deploy.ts';
import { AppEnvironment } from './app-environment.ts';
import { appImages, type AppImages } from './app-images.ts';
import { appRepository } from './app-repository.ts';
import { ENVIRONMENTS, type App } from './model.ts';
import { movedFromStackRoot } from './moved.ts';

/**
 * One app: what it has once, whatever the environment, and each of its environments.
 *
 * A component so that everything belonging to an app is one subtree of the stack — read
 * together in a plan, and depended on as a whole. What it is made of lives in the files named
 * after each concept; this only decides that an app has them, and in which order.
 *
 * Once per app rather than per environment: its image registry, so one build is promoted from
 * staging to production; its repository, and what that repository's workflows are told; and
 * the binding that lets its repository ask for a deployment.
 */
export class AppComponent extends pulumi.ComponentResource {
  readonly images: AppImages;
  readonly repository: github.Repository;

  constructor(app: App, options?: pulumi.ComponentResourceOptions) {
    super('medusa:platform:App', app, {}, options);

    const children = { parent: this, ...movedFromStackRoot };

    this.images = appImages(app, children);
    this.repository = appRepository(app, this.images, children);
    appDeployBinding(app, children);

    for (const environment of ENVIRONMENTS) {
      new AppEnvironment({ app, environment, images: this.images }, children);
    }

    this.registerOutputs({ repository: this.repository.fullName });
  }
}
