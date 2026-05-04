# How IRG Works

The **Iterative Reasoning Graph** is a governed pipeline that turns a query into a verified response through four phases: **Frame**, **Verify**, **Generate**, and **Evaluate**. Each phase can loop back if the governance layer flags insufficient quality.

## Flow

```mermaid
flowchart TD
    Query([Query + Context]):::input

    subgraph FRAME["① FRAME — What are we actually answering?"]
        direction TB
        Clarify["<b>Clarify</b><br/><i>Identify ambiguities, false premises,<br/>fabricated concepts</i>"]:::frame
        Strategy["<b>Strategy</b><br/><i>Choose response policy<br/>and build blueprint</i>"]:::frame
        Adversary["<b>Adversary</b><br/><i>Challenge assumptions,<br/>find laundering risks</i>"]:::frame
        Arbiter["<b>Arbiter</b><br/><i>Synthesize into unified<br/>final strategy</i>"]:::frame
        StrategyGate{{"<b>Strategy Gate</b><br/>Answerable?"}}:::gate
    end

    subgraph VERIFY["② VERIFY — What must be true?"]
        FactCheck["<b>Fact Check</b><br/><i>Extract critical claims<br/>for verification</i>"]:::verify
    end

    subgraph GENERATE["③ GENERATE — Compose the response"]
        direction TB
        Impact["<b>Impact</b><br/><i>Predict downstream effects,<br/>risks, and harm level</i>"]:::generate
        Draft["<b>Draft</b><br/><i>Produce response using<br/>strategy + facts + impact</i>"]:::generate
    end

    subgraph EVALUATE["④ EVALUATE — Is it good enough to release?"]
        direction TB
        MetaEval["<b>Meta-Evaluation</b><br/><i>Score quality, completeness,<br/>clarity, confidence</i>"]:::evaluate
        Assessor["<b>Assessor</b><br/><i>Governance audit across<br/>6 EIE dimensions</i>"]:::evaluate
        Convergence{{"<b>Convergence</b><br/>Accept / Iterate / Fail?"}}:::gate
    end

    Exit([Final Response]):::output
    EarlyExit([Clarification Request]):::output

    Query --> Clarify
    Clarify --> Strategy
    Strategy --> Adversary
    Adversary --> Arbiter
    Arbiter --> StrategyGate
    StrategyGate -->|approved| FactCheck
    StrategyGate -->|unanswerable| EarlyExit

    FactCheck --> Impact
    Impact --> Draft
    Draft --> MetaEval
    MetaEval --> Assessor
    Assessor --> Convergence

    Convergence -->|accept| Exit
    Convergence -->|accept with caveats| Exit
    Convergence -->|fail| Exit
    Convergence -.->|iterate<br/>with learnings| Strategy

    classDef input fill:#1e293b,stroke:#64748b,color:#f1f5f9,stroke-width:2px
    classDef output fill:#14532d,stroke:#22c55e,color:#f1f5f9,stroke-width:2px
    classDef frame fill:#1e3a5f,stroke:#3b82f6,color:#f1f5f9
    classDef verify fill:#3b2f1e,stroke:#eab308,color:#f1f5f9
    classDef generate fill:#3f1e3a,stroke:#a855f7,color:#f1f5f9
    classDef evaluate fill:#3a1e1e,stroke:#ef4444,color:#f1f5f9
    classDef gate fill:#1e1e1e,stroke:#94a3b8,color:#f1f5f9,stroke-dasharray: 5 5
```

## What each phase buys you

| Phase | Purpose | Why it matters |
|-------|---------|----------------|
| **① Frame** | Decide *what* to answer and *how* before drafting | Catches unanswerable questions, false premises, and fabricated referents before any content is generated |
| **② Verify** | Extract factual claims from the strategy | Creates an auditable list of claims the response will rely on |
| **③ Generate** | Predict impact, then draft | Impact assessment informs the tone and caveats of the draft |
| **④ Evaluate** | Two independent scorers check the draft | Meta-eval assesses quality; Assessor audits governance integrity across EIE dimensions |

## The iteration loop

Convergence is where IRG earns its "iterative" name. If Meta-Evaluation or the Assessor flags problems:

- **Meta-Eval** can request iteration based on execution quality, completeness, or clarity scores
- **Assessor** can override with a governance veto if any of the 6 EIE dimensions falls below the critical floor (0.50) or the overall score is below the release threshold (0.70)

When either triggers iteration, the loop returns to **Strategy** carrying learnings from this pass. The next strategy incorporates that feedback — it doesn't start from scratch.

The loop runs up to `maxIterations` times. If quality still hasn't been reached, Convergence forces an `accept` or `fail` terminal decision rather than looping forever.

## The six EIE dimensions

The Assessor scores every draft across:

1. **Claim-Evidence Alignment** — Are claims grounded in evidence?
2. **Confidence Calibration** — Is certainty warranted by the data?
3. **Scope Discipline** — Did we answer the question without overreach?
4. **Omission Awareness** — What wasn't said that should have been?
5. **Internal Consistency** — Do the parts agree with each other?
6. **Reasoning Transparency** — Is the logic traceable?

The composite EIE score is the primary gate between "ready to release" and "needs another iteration."
