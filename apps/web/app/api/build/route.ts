export const dynamic = 'force-static';
export function GET() {
  return Response.json({
    source: process.env.NOIR_BUILD_SOURCE,
    dirty: process.env.NOIR_BUILD_DIRTY,
    protocol: 'encrypted-deck-v1',
    bb: '5.2.0',
    deck_artifact_sha256: '89327e378ed1161825260eb6a5b3bca788d18d88fa8f09d4ee15d073a861b8e5',
    deck_vk_sha256: '4e82925a6ff56b94d62d3665899e44c87c9720f8bd47d250273a553d6d68ccc1',
    challenge_artifact_sha256: '1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d',
    challenge_vk_sha256: 'b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67',
  });
}
