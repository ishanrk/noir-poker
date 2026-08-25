import assert from "node:assert/strict";
import test from "node:test";

import { deriveSponsoredFpc, registerSponsoredFpc } from "../scripts/fpc.mjs";

const ADDRESS = "0x2ece607a8dba690c9aa4ee1d53a55286fa815543a27f9364bbaf65eb68e7315b";

test("derives the Aztec 5.2 sponsored fpc", async () => {
  const instance = await deriveSponsoredFpc(ADDRESS);

  assert.equal(instance.address.toString(), ADDRESS);
  await assert.rejects(
    deriveSponsoredFpc(
      "0x130925fbd734a252e3d8ddff87f6c346052dd5c13314eb96026b32baa1923296",
    ),
    /sponsored fpc mismatch/,
  );
});

test("registers the matching live instance", async () => {
  const instance = await deriveSponsoredFpc(ADDRESS);
  let registered;
  const wallet = {
    registerContract: async (value, artifact) => {
      registered = { value, artifact };
    },
  };
  const node = { getContract: async () => ({ ...instance }) };
  const result = await registerSponsoredFpc(wallet, node, ADDRESS);

  assert.equal(result.address.toString(), ADDRESS);
  assert.equal(registered.value.address.toString(), ADDRESS);
  assert.ok(registered.artifact);
});
