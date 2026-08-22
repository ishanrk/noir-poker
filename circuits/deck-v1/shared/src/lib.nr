use std::embedded_curve_ops::{
    EmbeddedCurvePoint, EmbeddedCurveScalar, fixed_base_scalar_mul, multi_scalar_mul,
};

pub struct Cipher {
    pub left: EmbeddedCurvePoint,
    pub right: EmbeddedCurvePoint,
}

pub fn encrypt(key: EmbeddedCurvePoint, value: Field, mask: Field) -> Cipher {
    let value = EmbeddedCurveScalar::from_field(value);
    let mask = EmbeddedCurveScalar::from_field(mask);
    let left = fixed_base_scalar_mul(mask);
    let right = multi_scalar_mul([EmbeddedCurvePoint::generator(), key], [value, mask]);

    Cipher { left, right }
}

pub fn remask(card: Cipher, mask: Field, key: EmbeddedCurvePoint) -> Cipher {
    let one = EmbeddedCurveScalar::from_field(1);
    let mask = EmbeddedCurveScalar::from_field(mask);
    let left = multi_scalar_mul([card.left, EmbeddedCurvePoint::generator()], [one, mask]);
    let right = multi_scalar_mul([card.right, key], [one, mask]);

    Cipher { left, right }
}

pub fn valid_permutation<let N: u32>(values: [u32; N]) {
    let sorted = values.sort();

    for i in 0..N {
        assert(sorted[i] == i as u32);
    }
}
