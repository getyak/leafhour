// Finite Release-equivalence proof for the reviewed d302393d -> 33bfa919
// GET-328 preparation. These are Git blob IDs, not commit IDs. Do not turn this
// into a directory-wide DEBUG/project exemption or infer equivalence from a patch.
const reviewedPairs=new Map([
  ['apps/ios/project.yml',['6f4f1640cecae45e2ee86f692df8bdeb840ac640','026bfb94225bb058ceb725147f3678cd2df3d5a8']],
  ['apps/ios/Leafhour.xcodeproj/project.pbxproj',['7020d4306d650f6d8680b77e055c213727295e03','5c0645ea7ce691dd3e98d37a4eaa48da66f66c7b']],
  ['apps/ios/Leafhour/VideoAcceptanceFixture.swift',['352f1e568158996348fdef37d69746b2e46a07fd','d37c67f3ccfff4ab4ea6cc52d978b9f0e081fbd7']],
]);
const qaOnly=new Set([
  'apps/ios/Config/GET328Acceptance.xcconfig',
  'apps/ios/Config/GET328Acceptance-Info.plist',
  'apps/ios/Leafhour.xcodeproj/xcshareddata/xcschemes/LeafhourGET328CurrentAcceptance.xcscheme',
]);
const decisionOnly=new Set(['scripts/ios/prepare.mjs','scripts/ios/release-changes.mjs']);
const hostOnly=new Set(['tools/generate-get328-alice-pdf73.mjs',
  'scripts/ios/get328_build_only.py','scripts/ios/build_only_budget.py']);
const statuses=new Set(['added','modified','removed','renamed','copied','changed','unchanged']);
const isSha=value=>typeof value==='string' && /^[a-f0-9]{40}$/.test(value);
const isPath=value=>typeof value==='string' && value.length>0 && !/[\\\0\r\n]/.test(value)
  && !value.split('/').some(part=>part==='' || part==='.' || part==='..');
const relevant=reason=>({releaseRelevant:true,reason});

// Current archive-layout contract: the default Leafhour Release archive does
// not consume these tests, QA configuration/scheme, web/service or prose paths.
// A future build graph that consumes them must update this classifier in the
// same reviewed change. Unknown inputs remain relevant, including CI/dependency
// files; archive/upload/signing/provenance helpers are not decision-only.
function nonBinary(path) {
  return qaOnly.has(path) || decisionOnly.has(path) || hostOnly.has(path)
    || /^(apps\/ios\/(?:LeafhourUITests\/|LeafhourAppTests\/|LeafhourCore\/Tests\/|verification\/)|apps\/(?:api|agent)\/|tests\/|docs\/|_briefs\/|app\/|server\/|api\/|catalog\/)/.test(path)
    || /^(?:AGENTS\.md|DESIGN\.md|PRODUCT\.md|LICENSE|README(?:\.[A-Za-z-]+)?\.md|SECURITY(?:\.[A-Za-z-]+)?\.md)$/.test(path);
}

/** Only a trusted Apple receipt may supply baseSha. This function does no I/O
 * except exact baseline metadata reads supplied by the existing GitHub client. */
export async function classifyIOSReleaseChanges({comparison,baseSha,headSha,readBaseFile}) {
  if(!isSha(baseSha) || !isSha(headSha) || !comparison
    || !['ahead','identical'].includes(comparison.status)
    || comparison.base_commit?.sha!==baseSha || comparison.merge_base_commit?.sha!==baseSha
    || !Array.isArray(comparison.files) || comparison.files.length>=300
    || (comparison.status==='identical' && (headSha!==baseSha || comparison.files.length!==0))) {
    return relevant('Cannot prove a complete comparison from the trusted receipt commit');
  }
  const pending=[];
  for(const file of comparison.files) {
    if(!file || !isPath(file.filename) || !statuses.has(file.status) || !isSha(file.sha)
      || (file.previous_filename!==undefined && !isPath(file.previous_filename))
      || (file.status==='renamed' && !file.previous_filename)) return relevant('Unrecognized change metadata');
    const paths=[file.filename,...(file.previous_filename ? [file.previous_filename] : [])];
    for(const path of paths) {
      if(nonBinary(path)) continue;
      const pair=reviewedPairs.get(path);
      if(!pair || path!==file.filename || file.status!=='modified' || file.previous_filename!==undefined || file.sha!==pair[1]) {
        return relevant('Release product or unreviewed build input changed: '+path);
      }
      pending.push({path,before:pair[0]});
    }
  }
  for(const {path,before} of pending) {
    let base;
    try {base=await readBaseFile(path);} catch {
      // A permission/provider failure cannot authorize either a skip or an
      // unnecessary upload. Keep the preparation job failed and make no plan.
      throw Error('Cannot verify Release-equivalent baseline metadata for '+path);
    }
    if(base?.type!=='file' || base.path!==path || base.sha!==before) return relevant('Release equivalence has a different baseline: '+path);
  }
  return {releaseRelevant:false,reason:'Only non-binary tests/support or exact reviewed Release-equivalent changes since the trusted Apple VALID receipt'};
}
