// Starts the "Evening brief" workflow on GitHub. Runs on the timer in wrangler.toml.
export default {
  async scheduled(event, env, ctx) {
    const res = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/${env.WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'sensa-evening-trigger',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    // a thrown error marks the run as failed in Cloudflare's dashboard
    if (!res.ok) throw new Error(`GitHub answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    console.log(`Started ${env.WORKFLOW} (${event.cron})`);
  },
};
