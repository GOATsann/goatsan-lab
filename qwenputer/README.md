# Qwenputer experiments

What I tested on [Qwenputer](https://github.com/divagr18/qwenputer) by Divyansh Agrawal: Qwen3.5-4B
with a RISC-V computer compiled into its weights. Everything ran on one RTX A5000 (24 GB).

**Code, prompts, results and how to reproduce them:**
[github.com/GOATsann/qwenputer, branch `goatsan-lab`](https://github.com/GOATsann/qwenputer/tree/goatsan-lab/lab)
(a fork of Qwenputer, MIT license).

## Exact math (E0, E9)
800 big-number problems (DeepMind Mathematics, extrapolate sets), one per prompt, no tools for the
API models. Problems whose answer only restates the question as a fraction are left out (744 left).

| Model | Exact |
|---|---|
| GPT-5.5 | 99.7% |
| Qwenputer + a clearer instruction | 96.6% (97.6% on 800 unseen problems) |
| Qwenputer | 96.2% |
| Claude Fable 5.2 | 96.0% (97.4% if a correct fraction written next to a rounded answer counts) |
| Qwen3.5-4B, same model without the computer | 76.3% |

The computer inside made **0 errors** in 73.8 million checked steps. Every Qwenputer miss came from
the language model: looping on the tool, rewriting an exact fraction as a wrong decimal, or sending
the wrong expression.

## A word ban inside the weights (EA)
- **Word ban:** one extra column in the model's word table, switched on by the compiled computer.
  It pushes the 4 tokens " mother", " Mother", "mother", "Mother" down by about 142 million. Any model
  can do this with a weight edit.
- **Piece tracker:** the compiled computer remembers the last few tokens. If they spell the start of
  the word (m, mo, mot, moth, mothe), it pushes down the pieces that would finish it. This needs exact
  memory and logic, which here are compiled into the model.

| 40 prompts per set ("mother" written) | No ban | Word ban | Word ban + piece tracker |
|---|---|---|---|
| Asking for the word | 32 | 7 | 6 |
| Trick prompts | 32 | 11 | 6 |
| Unrelated prompts | 1 | 0 | 0 (39/40 answers identical) |

It is not a perfect ban. The word still gets out with separators (M-O-T-H-E-R), spaces ("m other")
and longer words ("mothers", "grandmother").
