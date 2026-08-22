use deck_shared::{Cipher, encrypt, remask, valid_permutation};
use std::embedded_curve_ops::{EmbeddedCurvePoint, EmbeddedCurveScalar, fixed_base_scalar_mul};

global DECK_SIZE: u32 = 52;

fn main(
    protocol_version: pub u8,
    hand_no: pub u64,
    seat: pub u8,
    context: pub [u8; 32],
    input_left_x: pub [Field; DECK_SIZE],
    input_left_y: pub [Field; DECK_SIZE],
    input_right_x: pub [Field; DECK_SIZE],
    input_right_y: pub [Field; DECK_SIZE],
    output_left_x: pub [Field; DECK_SIZE],
    output_left_y: pub [Field; DECK_SIZE],
    output_right_x: pub [Field; DECK_SIZE],
    output_right_y: pub [Field; DECK_SIZE],
    key_x: pub Field,
    key_y: pub Field,
    permutation: [u32; DECK_SIZE],
    masks: [Field; DECK_SIZE],
) {
    assert(protocol_version == 1);
    assert(seat <= 6);
    assert(hand_no <= 0x7fffffffffffffff);

    let mut context_nonzero = false;
    for byte in context {
        context_nonzero = context_nonzero | (byte != 0);
    }
    assert(context_nonzero);

    let key = EmbeddedCurvePoint { x: key_x, y: key_y };

    valid_permutation(permutation);

    for i in 0..DECK_SIZE {
        assert(masks[i] != 0);
        let source = permutation[i];
        let card = Cipher {
            left: EmbeddedCurvePoint { x: input_left_x[source], y: input_left_y[source] },
            right: EmbeddedCurvePoint { x: input_right_x[source], y: input_right_y[source] },
        };
        let next = remask(card, masks[i], key);

        assert(next.left.x == output_left_x[i]);
        assert(next.left.y == output_left_y[i]);
        assert(next.right.x == output_right_x[i]);
        assert(next.right.y == output_right_y[i]);
    }
}

#[test]
fn reverse_deck() {
    let key = fixed_base_scalar_mul(EmbeddedCurveScalar::from_field(7));
    let mut input_left_x = [0; DECK_SIZE];
    let mut input_left_y = [0; DECK_SIZE];
    let mut input_right_x = [0; DECK_SIZE];
    let mut input_right_y = [0; DECK_SIZE];
    let mut output_left_x = [0; DECK_SIZE];
    let mut output_left_y = [0; DECK_SIZE];
    let mut output_right_x = [0; DECK_SIZE];
    let mut output_right_y = [0; DECK_SIZE];
    let mut permutation = [0; DECK_SIZE];
    let mut masks = [0; DECK_SIZE];

    for i in 0..DECK_SIZE {
        let card = encrypt(key, i as Field + 1, i as Field + 1);
        input_left_x[i] = card.left.x;
        input_left_y[i] = card.left.y;
        input_right_x[i] = card.right.x;
        input_right_y[i] = card.right.y;
    }

    for i in 0..DECK_SIZE {
        permutation[i] = (DECK_SIZE - i - 1) as u32;
        masks[i] = i as Field + 100;
        let source = permutation[i];
        let card = Cipher {
            left: EmbeddedCurvePoint { x: input_left_x[source], y: input_left_y[source] },
            right: EmbeddedCurvePoint { x: input_right_x[source], y: input_right_y[source] },
        };
        let next = remask(card, masks[i], key);
        output_left_x[i] = next.left.x;
        output_left_y[i] = next.left.y;
        output_right_x[i] = next.right.x;
        output_right_y[i] = next.right.y;
    }

    main(
        1,
        7,
        2,
        [9; 32],
        input_left_x,
        input_left_y,
        input_right_x,
        input_right_y,
        output_left_x,
        output_left_y,
        output_right_x,
        output_right_y,
        key.x,
        key.y,
        permutation,
        masks,
    );
}
