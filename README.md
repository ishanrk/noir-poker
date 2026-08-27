# Noir Poker

Live website: https://noirpoker.ishankumthekar.com

In general, online poker is vulnerable to the server cheating.
- For example, the server can deal better cards favoring certain players.
- The server can lie visually about what cards are being played.
- In a real world casino you can inspect dealers, however this is harder online.

The fixes for this problem are well known:
- Have a commitment scheme which forces the server to chose a deck that is sampled based on every player's fresh randomness and is checkable by each player (basic crypto commit scheme)
- - You also have mental poker https://en.wikipedia.org/wiki/Mental_poker 

My version also adds simple challenges like: "Raise before the flop" or "Bluff and win with a seven deuce" etc for extra bonus chips.

Ideally while playing poker you don't want to disclose what your hand is or was in general which makes the task of other people verifying that you finished a challenge difficult.

This is where I've implemented a zk protocol using the language Noir. Full details of the protocol can be seen on the website (alogn with downloadable proofs)! 
