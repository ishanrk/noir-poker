# Provenance decisions

The existing Tabler SVG asset license is preserved at apps/web/public/assets/TABLER-LICENSE.txt. Dependency licenses are supplied by the installed dependencies and lockfiles retain their pinned resolutions. This task did not replace artwork, fonts, or sounds.

There is no repository source license in the inspected checkout. The owner must choose one if redistribution is intended. No permissive license has been inserted.

The Block Blueprint font, pickup and error WAV files, and other local illustration and media assets lack a complete repository level provenance ledger. Their presence does not establish redistribution rights. Confirm the original sources, allowed uses, and required notices with the owner before public packaging.

The linked cryptography papers retain their original titles and attribution. They are references for related ideas, not a claim that their full protocols are implemented here.

Local `npm ci` reported 47 dependency graph vulnerabilities. A subsequent `npm audit --omit=dev --json` reported 46, including seven high severity package entries. The high entries were transitive packages in the installed graph, including undici, ws, systeminformation, and OpenTelemetry dependencies. This is not a finding that each advisory is reachable through ordinary play. The raw inventory is retained locally at `.local/polish/dependency-audit.json`. No force upgrade or incompatible proving-library replacement was applied. Review reachability and compatible updates before release; pinned dependency compatibility is not a security clearance.
