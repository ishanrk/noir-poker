use aztec::macros::aztec;

#[aztec]
pub contract PlayChips {
    use aztec::{
        macros::{functions::{external, initializer, only_self}, storage::storage},
        messages::delivery::MessageDelivery,
        protocol::address::AztecAddress,
        state_vars::{Map, Owned, PublicMutable},
    };
    use balance_set::BalanceSet;

    global CLAIM_AMOUNT: u64 = 10_000;
    global MAX_SEATS: u32 = 6;

    #[storage]
    struct Storage<Context> {
        owner: PublicMutable<AztecAddress, Context>,
        claimed: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
        entries: Map<Field, PublicMutable<bool, Context>, Context>,
        entry_tables: Map<Field, PublicMutable<Field, Context>, Context>,
        entry_amounts: Map<Field, PublicMutable<u64, Context>, Context>,
        table_pool: Map<Field, PublicMutable<u64, Context>, Context>,
        table_settled: Map<Field, PublicMutable<bool, Context>, Context>,
        private_balances: Owned<BalanceSet<Context>, Context>,
    }

    #[initializer]
    #[external("public")]
    fn setup() {
        self.storage.owner.write(self.msg_sender());
    }

    #[external("private")]
    fn claim_private() {
        let player = self.msg_sender();

        self.enqueue_self._record_claim(player);
        self.storage.private_balances.at(player).add(CLAIM_AMOUNT as u128).deliver(
            MessageDelivery::onchain_constrained(),
        );
    }

    #[external("public")]
    #[only_self]
    fn _record_claim(player: AztecAddress) {
        assert(!self.storage.claimed.at(player).read(), "Play chips already claimed");
        self.storage.claimed.at(player).write(true);
    }

    #[external("private")]
    fn enter_table(table_id: Field, entry_id: Field, amount: u64) {
        assert(amount > 0, "Buy-in must be positive");

        let player = self.msg_sender();
        self.storage.private_balances.at(player).sub(amount as u128).deliver(
            MessageDelivery::onchain_constrained(),
        );
        self.enqueue_self._record_entry(table_id, entry_id, amount);
    }

    #[external("public")]
    #[only_self]
    fn _record_entry(table_id: Field, entry_id: Field, amount: u64) {
        assert(!self.storage.table_settled.at(table_id).read(), "Table already settled");
        assert(!self.storage.entries.at(entry_id).read(), "Entry already used");

        self.storage.entries.at(entry_id).write(true);
        self.storage.entry_tables.at(entry_id).write(table_id);
        self.storage.entry_amounts.at(entry_id).write(amount);

        let pool = self.storage.table_pool.at(table_id).read();
        self.storage.table_pool.at(table_id).write(pool + amount);
    }

    #[external("private")]
    fn settle_private(
        table_id: Field,
        recipients: [AztecAddress; MAX_SEATS],
        payouts: [u64; MAX_SEATS],
    ) {
        let caller = self.msg_sender();
        let mut total: u64 = 0;

        for i in 0..MAX_SEATS {
            let payout = payouts[i];
            total += payout;

            if payout > 0 {
                self.storage.private_balances.at(recipients[i]).add(payout as u128).deliver(
                    MessageDelivery::onchain_constrained(),
                );
            }
        }

        self.enqueue_self._record_settlement(table_id, total, caller);
    }

    #[external("public")]
    #[only_self]
    fn _record_settlement(table_id: Field, total: u64, caller: AztecAddress) {
        assert_eq(caller, self.storage.owner.read(), "Only the game server can settle");
        assert(!self.storage.table_settled.at(table_id).read(), "Table already settled");
        assert_eq(total, self.storage.table_pool.at(table_id).read(), "Payouts must equal the pool");

        self.storage.table_settled.at(table_id).write(true);
    }

    #[external("utility")]
    unconstrained fn private_balance_of(owner: AztecAddress) -> pub u128 {
        self.storage.private_balances.at(owner).balance_of()
    }

    #[external("utility")]
    unconstrained fn has_claimed(owner: AztecAddress) -> pub bool {
        self.storage.claimed.at(owner).read()
    }

    #[external("utility")]
    unconstrained fn entry_exists(entry_id: Field) -> pub bool {
        self.storage.entries.at(entry_id).read()
    }

    #[external("utility")]
    unconstrained fn entry_table_of(entry_id: Field) -> pub Field {
        self.storage.entry_tables.at(entry_id).read()
    }

    #[external("utility")]
    unconstrained fn entry_amount_of(entry_id: Field) -> pub u64 {
        self.storage.entry_amounts.at(entry_id).read()
    }

    #[external("utility")]
    unconstrained fn table_pool_of(table_id: Field) -> pub u64 {
        self.storage.table_pool.at(table_id).read()
    }

    #[external("utility")]
    unconstrained fn table_is_settled(table_id: Field) -> pub bool {
        self.storage.table_settled.at(table_id).read()
    }

    #[external("utility")]
    unconstrained fn contract_owner() -> pub AztecAddress {
        self.storage.owner.read()
    }

    #[external("utility")]
    unconstrained fn faucet_amount() -> pub u64 {
        CLAIM_AMOUNT
    }
}
