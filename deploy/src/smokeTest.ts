/**
 * Whether what was just deployed actually serves.
 *
 * A deployment succeeding means the API calls it made returned, which is a claim
 * about Cloudflare's records rather than about the site. This asks the site, from
 * outside, the way a browser would: the page comes back, it is the app rather than a
 * placeholder or an error page dressed as a 200, and the bundle the page asks for
 * exists.
 *
 * It is deliberately not exhaustive. It is the difference between "deployed" and
 * "answering", which is the difference that decides whether the next environment
 * should be touched at all.
 */

/** What a page must contain to be this app rather than something else answering. */
const ROOT_ELEMENT = '<div id="root">';

const SCRIPT_SOURCE = /<script[^>]+\bsrc="([^"]+)"/;

/**
 * A new Worker version is not everywhere the instant the upload returns. Retrying is
 * not papering over flakiness — it is the propagation this is meant to wait out.
 */
const ATTEMPTS = 10;
const DELAY_MS = 3_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fetchOk = async (url: string | URL, headers: Record<string, string>): Promise<Response> => {
  const response = await fetch(url, {
    headers,

    // Not followed. The sign-in in front of an app answers a request it will not admit by
    // redirecting to its login page, and following that would test the login page — which
    // answers, and is not the app.
    redirect: 'manual',
  });

  if (!response.ok) {
    throw new Error(`${url.toString()} answered ${response.status}`);
  }

  return response;
};

const attempt = async (url: string, headers: Record<string, string>): Promise<void> => {
  const page = await fetchOk(url, headers);
  const html = await page.text();

  if (!html.includes(ROOT_ELEMENT)) {
    throw new Error(`${url} answered, but with something other than the app`);
  }

  const source = SCRIPT_SOURCE.exec(html)?.[1];

  if (source === undefined) {
    throw new Error(`${url} served a page that loads no script`);
  }

  // The page naming a bundle proves nothing about the bundle being there. Assets are
  // uploaded separately from the Worker, so this is a thing that can genuinely differ.
  await fetchOk(new URL(source, url), headers);
};

/** Whether [url] serves the app, asked with [headers] — whatever gets a request past the sign-in. */
export const smokeTest = async (url: string, headers: Record<string, string>): Promise<void> => {
  for (let remaining = ATTEMPTS; ; remaining--) {
    try {
      await attempt(url, headers);

      return;
    } catch (cause) {
      if (remaining <= 1) {
        throw new Error(`${url} never served the app`, { cause });
      }

      await delay(DELAY_MS);
    }
  }
};
