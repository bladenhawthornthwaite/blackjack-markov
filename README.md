# The House Always Loses?

A Markov chain model of blackjack, built to derive optimal player strategy and measure how much Hi-Lo card counting actually moves the house edge.

**Bladen Hawthornthwaite, Dov Karlin, Lukas Horvat** — Discrete Math & Probability, Duke University, Spring 2026

![Poster](docs/poster.jpg)

## Research Question

Can we reverse-engineer a strategy for optimal blackjack play using Markov chains and expected returns, and how does it compare to other basic strategies and card counting in terms of impact on house edge?

## Approach

- **Modeling blackjack as a Markov chain.** States are defined by hand total, hard/soft status, and dealer upcard. Transitions are weighted by card probabilities under an infinite-deck assumption; player busts and the dealer's final outcome (17–21 or bust) are absorbing states.
- **Deriving optimal play at every state.** Standing value is computed by propagating the dealer's transition matrix forward to its absorbing states. Hitting value is computed recursively, comparing the expected value of standing versus hitting at every reachable hand total. The action with higher EV defines the optimal policy.
- **Hi-Lo card counting extension.** Card-counting tags (+1 low, 0 neutral, −1 high) update a running count as the shoe depletes, converted to a true count (running count / decks remaining) that dynamically reweights the deck-composition probabilities used in the optimal-play derivation — moving the model from a static infinite-deck assumption to one that reflects a depleting 6-deck shoe.
- **Monte Carlo validation.** 50,000 hands simulated across random play, basic strategy, optimal EV-derived strategy, and optimal strategy + Hi-Lo bet sizing, to validate the theoretical house edge against simulated results and measure bankroll variance.


## Repo Contents

| File | Description |
|---|---|
| `Blackjack_Opt.ipynb` | Markov chain construction, dealer transition matrix, optimal play derivation (standing/hitting EV), Hi-Lo true count integration |
| `Blackjack_Simulator.ipynb` | Monte Carlo simulation engine — runs and compares strategies across thousands of simulated hands |
| `blackjack_simulator.jsx` | React port of the simulation engine for interactive play/visualization |
| `docs/poster.jpg` | Final presentation poster |

## Assumptions

- 6-deck shoe (312 cards), reshuffled at 75% penetration
- Dealer hits soft 17, stands on hard 17+
- No splitting (modeled as future work — see below)
- Infinite-deck assumption for the baseline Markov chain; true count dynamically reweights this for the counting extension

## What Was Difficult / Future Work

- **No splitting:** scoped out of this version, reduces the size of the state space but limits realism relative to full casino play
- **Hand selection / shoe depth:** house edge is highly sensitive to penetration — the deeper the shoe, the more counting matters
- **Infinite-deck assumption vs. dynamic reweighting:** reconciling the static Markov baseline with the dynamically-updating Hi-Lo probabilities was the most conceptually difficult part of the project

## References

See poster for full citations (Baldwin, Cantey, Maisel & McDermott 1956; Chen 2004; Thorp; and course materials).

