// Read only the exact source's provider status. Do not send the GitHub token
// to the application, a status target URL, or a redirect destination.
export async function assertDeploymentNotRejected({repository, commit, token, fetchImpl = fetch} = {}) {
  if (!token) return;
  if (repository !== 'getyak/leafhour' || !/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid production status source');
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/commits/${commit}/status?per_page=100`, {
    headers:{Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28'},
    redirect:'error', signal:AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('Deployment status lookup returned ' + response.status);
  const {statuses} = await response.json();
  if (!Array.isArray(statuses)) throw Error('Invalid deployment statuses');
  // Combined status returns the latest entry for each context. Taking the
  // first also stays correct if the API includes older entries later.
  const provider = statuses.find(status => status.context === 'Vercel');
  if (provider && ['failure', 'error'].includes(provider.state)) {
    throw Error('Vercel rejected deployment for source ' + commit + '; stop waiting and resolve the provider failure before retrying.');
  }
}
