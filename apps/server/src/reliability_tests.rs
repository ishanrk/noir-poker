use super::*;

fn create(key: Uuid, players: usize) -> CreateRoomRequest {
    serde_json::from_value(serde_json::json!({
        "request_key": key, "mode": "multiplayer", "name": "Alice",
        "players": players, "stack": 1000, "small_blind": 5, "big_blind": 10,
        "entropy": "11".repeat(32)
    }))
    .unwrap()
}

#[tokio::test]
#[ignore = "requires dedicated TEST_DATABASE_URL"]
async fn retry_identity_and_wager_effect() {
    let db = Db::connect(&env::var("TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let state = AppState::test(db.clone(), HashMap::new());
    let key = Uuid::new_v4();
    let (_, Json(first)) = create_room(AxumState(state.clone()), Json(create(key, 2)))
        .await
        .unwrap();
    let (_, Json(repeated)) = create_room(AxumState(state.clone()), Json(create(key, 2)))
        .await
        .unwrap();
    assert_eq!(first.room_id, repeated.room_id);
    assert_eq!(first.token, repeated.token);
    assert!(matches!(
        create_room(AxumState(state.clone()), Json(create(key, 3))).await,
        Err((StatusCode::CONFLICT, _))
    ));
    let join_key = Uuid::new_v4();
    let join = |name: &str| {
        serde_json::from_value(serde_json::json!({
            "request_key": join_key, "name": name, "entropy": "22".repeat(32)
        }))
        .unwrap()
    };
    let Json(joined) = join_room(
        AxumState(state.clone()),
        Path(first.room.clone()),
        Json(join("Bob")),
    )
    .await
    .unwrap();
    let Json(rejoined) = join_room(
        AxumState(state.clone()),
        Path(first.room.clone()),
        Json(join("Bob")),
    )
    .await
    .unwrap();
    assert_eq!(joined.seat, rejoined.seat);
    assert_eq!(joined.token, rejoined.token);
    assert!(matches!(
        join_room(
            AxumState(state.clone()),
            Path(first.room.clone()),
            Json(join("Carol"))
        )
        .await,
        Err((StatusCode::CONFLICT, _))
    ));
    let room = find_room(&state, first.room_id).await.unwrap();
    let seat = room.lock().await.hand.as_ref().unwrap().game.turn;
    apply_action_checked(&state, first.room_id, seat, Action::Fold, Some((0, 0)))
        .await
        .unwrap();
    let rev = room.lock().await.rev;
    apply_action_checked(&state, first.room_id, seat, Action::Fold, Some((0, 0)))
        .await
        .unwrap();
    assert_eq!(room.lock().await.rev, rev);
    assert!(
        apply_action_checked(&state, first.room_id, seat, Action::Call, Some((0, 0)))
            .await
            .is_err()
    );
    assert!(
        apply_action_checked(&state, first.room_id, seat, Action::Fold, Some((1, 0)))
            .await
            .is_err()
    );
    assert_eq!(room.lock().await.hand.as_ref().unwrap().actions.len(), 1);
    assert!(
        ready_room_entropy_checked(&state, first.room_id, 0, &"33".repeat(32), Some(8))
            .await
            .is_err()
    );
    room.lock().await.last_activity = std::time::Instant::now() - Duration::from_secs(1801);
    room_retention::retire_idle(&state, room_retention::IDLE_ROOM).await;
    assert!(find_room(&state, first.room_id).await.is_none());
    assert!(room.lock().await.retired);
    assert_eq!(
        db.interruption_reason(first.room_id)
            .await
            .unwrap()
            .as_deref(),
        Some("idle_timeout")
    );
    assert_eq!(
        db.last_completed_deck(first.room_id).await.unwrap(),
        Some(0)
    );
    let Json(history) = hand_history(AxumState(state.clone()), Path(first.room.clone()))
        .await
        .unwrap();
    assert_eq!(history.hands.len(), 1);
    assert!(
        !db.load_rooms()
            .await
            .unwrap()
            .iter()
            .any(|room| room.id == first.room_id)
    );
    room_retention::retire_idle(&state, Duration::ZERO).await;
    assert_eq!(
        db.interruption_reason(first.room_id)
            .await
            .unwrap()
            .as_deref(),
        Some("idle_timeout")
    );
}
