# **Iterative Reasoning Graphs (IRG)**

## **A Protocol for Persistent, Executable, Iterative Cognition**

*Whitepaper v0.3 — Draft for Collaboration*

---

## **Abstract**

We introduce **Iterative Reasoning Graphs (IRGs)**: a protocol for persistent, structured reasoning in AI systems.

An IRG represents reasoning not as a transient chain-of-thought, nor as implicit neural state, but as an **explicit, evolving graph of executable reasoning units**. Nodes encode plans, checks, critiques, or transformations; edges encode dependency, causality, and revision flow.

Unlike prior approaches that externalize reasoning only as logs, explanations, or traces, **IRGs are first-class, executable control structures that actively govern future reasoning**. Reasoning persists across time, supports iteration, exposes internal state, and enables deliberate refinement *without retraining*.

IRGs are designed to operate alongside generative models, episodic memory systems, and external tools, forming a **cognitive control plane** that governs how systems think, revise, and converge.

The result is an architecture that **updates reasoning structures, not just weights or prompts**—enabling traceability, safety, composability, and long-horizon cognition on commodity hardware.

---

## **1\. Motivation**

Modern AI systems reason in isolated episodes.

A model generates a response.
The reasoning evaporates.
Errors are discovered only after deployment.

Attempts to address this—chain-of-thought prompting, self-critique loops, tool orchestration—remain **procedural techniques**, not architectural commitments. They lack persistence, structure, and identity across time.

What is missing is a **first-class representation of reasoning itself**.

The **Iterative Reasoning Graph (IRG)** addresses this gap by treating reasoning as:

* **Persistent** — survives beyond a single response  
* **Structured** — explicit nodes and edges, not latent traces  
* **Executable** — nodes represent actions, checks, or transformations  
* **Iterative** — reasoning improves through revision cycles  
* **Inspectable** — internal state is exportable and auditable

IRGs have stable identifiers across executions, allowing reasoning state to persist, branch, or be resumed across sessions.

In systems without persistent reasoning structures, error correction cost grows with prompt length and iteration count. In IRG-based systems, correction is localized: **only the affected subgraph is revised**.

The IRG is not a model. It is the **substrate that governs how models are used**.

---

## **2\. Architectural Overview**

### **2.1 Core Components**

| Component | Role | Description |
| :---: | :---: | :---: |
| **Memory Store** | Episodic substrate | Stores factual observations, embeddings, events, and signals. |
| **Iterative Reasoning Graph (IRG)** | Cognitive substrate | A graph of executable reasoning nodes representing tasks, hypotheses, checks, and revisions. |
| **Execution & Scheduling Layer** | Control substrate | Orchestrates iteration, detects instability, and enforces convergence criteria. |
| **Generative Models** | Synthesis engines | Used to draft, critique, transform, or extend reasoning nodes. |

The IRG **does not replace** generative models.
It **controls how and when they are invoked**.

---

### **2.2 Reasoning Nodes**

An IRG node is **not descriptive metadata**.
It is an **executable reasoning contract**.

Each node defines *what must be done*, *why it exists*, and *how its output affects the graph*.

Example schema:

```json
{
  "id": "node_042",
  "type": "fact_check",
  "goal": "Verify historical claims in draft response",
  "inputs": ["node_031", "memoryFetch:event_889"],
  "procedure": [
    "extract factual assertions",
    "query memoryFetch for supporting evidence",
    "flag inconsistencies or uncertainty"
  ],
  "status": "pending",
  "confidence": 0.62,
  "last_updated": "2025-12-01T00:00Z"
}
```

Node procedures may:

* Invoke generative models  
* Call external tools  
* Query memory systems  
* Trigger creation, revision, or invalidation of other nodes

Common node types include:

* **Draft**  
* **Clarification**  
* **Fact-check**  
* **Critique**  
* **Risk / impact prediction**  
* **Revision**  
* **Planning / decomposition**  
* **Termination / convergence check**

Edges encode *why* nodes exist, not mere similarity:

* `depends_on`  
* `refines`  
* `invalidates`  
* `supersedes`  
* `requires_clarification`

---

## **3\. The IRG Iteration Cycle**

The IRG defines **iteration as a first-class architectural primitive**, not an emergent behavior.

A canonical **IRG Iteration Cycle (IIC)**:

1. **Clarify**  
    Identify missing assumptions or ambiguities.

2. **Draft**  
    Generate an initial response or plan.

3. **Factual Evaluate**  
    Fact-check, critique, and assess coherence.

4. **Predict Impact**  
    Estimate downstream effects (user response, risk, failure modes).

5. **Revise**  
    Apply targeted changes to affected nodes.

6. **Converge or Iterate**  
    Convergence is not a single condition. Systems may converge by:  
* confidence stabilization  
* bounded revision without improvement  
* explicit abstention  
* external approval  
* budget exhaustion

7. **Record**  
    Persist deltas, confidence, and outcomes.

Each step is **explicitly represented as graph nodes**.  
Reasoning is **versioned, replayable, and inspectable**.

---

## **4\. Knowledge & Stability Dynamics**

Over time, an IRG develops structure analogous to a living system:

| Region | Description |
| :---: | :---: |
| **Hot Path** | Active reasoning chains under iteration. |
| **Cold Core** | Stable reasoning templates reused across tasks. |
| **Archived Trails** | Deprecated or failed reasoning paths retained for provenance. |

This enables **conceptual homeostasis**:

* Local perturbations trigger local adaptation  
* Stable reasoning resists unnecessary churn  
* Errors are traceable to specific nodes and revisions

This structure prevents **catastrophic reasoning drift**, where repeated self-critique degrades rather than improves outputs.

---

## **5\. Why This Is Architecturally Different**

### **5.1 Beyond Chain-of-Thought**

Chain-of-thought is:

* Linear  
* Ephemeral  
* Uninspectable  
* Unsafe to expose

IRGs are:

* Graph-structured  
* Persistent  
* Auditable  
* Designed for exposure

### **5.2 Beyond Self-Critique**

Self-critique is:

* Prompt-level  
* Stateless  
* Non-convergent

IRGs provide:

* Explicit critique nodes  
* Confidence tracking  
* Structural termination criteria

### **5.3 Beyond Fine-Tuning**

Fine-tuning is:

* Slow  
* Opaque  
* Globally invasive

IRGs enable:

* Local edits  
* Interpretable change  
* Immediate effect

---

## **6\. Safety, Traceability, and Governance**

By externalizing reasoning as structure:

* Decisions are **auditable without weights**  
* Policies are **enforceable without retraining**  
* Internal state is **exportable without exposing model internals**  
* Failures are **localized, not global**

This enables **safety by architecture**, not alignment by heuristic.

Quality of Implementation significantly impacts quality of reasoning:

* Auditability does not imply correctness—a fully traced poorly structured graph will produce poor results.  
* Policy enforcement depends on policy quality—IRGs execute whatever nodes they're given

Relation to [Epistemic Integrity Evaluations \(EIE\)](https://github.com/arcus-labs/EIE-spec):

* IRG structures *process*; EIE evaluates *outcomes*.  
* EIE can be applied to IRG and non-IRG systems alike.  
* IRG provides architectural affordances that may improve EIE scores, but does not guarantee them. 

**IRGs do not guarantee correctness, truth, or alignment. Poorly designed nodes, biased evaluators, or adversarial objectives can still produce harmful outcomes. IRGs make such failures inspectable, not impossible.**

---

## **7\. Implementation Strategy**

### **Phase I — Protocol Definition**

* IRG node and edge schema  
* Canonical iteration cycles  
* Reference Rust implementation

### **Phase II — Model Integration**

* IRG-driven inference  
* Critique and revision passes  
* Externally sourced content augmentation (ex: RAG integration)

### **Phase III — Tooling & Ecosystem**

* Visualization and replay  
* Certification and trace formats  
* Integration with productivity systems

### **Phase IV — Standardization**

* IRG trace interchange format  
* Partial cross-model compatibility  
* Compliance and conformance tests

---

## **8\. Minimal IRG Compliance**

This section defines the **minimum requirements** for a system to be considered *IRG-compliant*.

These requirements are intentionally minimal. They do not prescribe internal model architecture, tooling choices, or optimization strategies. They exist solely to preserve conceptual integrity and interoperability.

It is important to note that IRG is **not a workflow system**.

An IRG is an **externalized, engineered reasoning structure** that mediates all model interactions between the user and generative components.

IRG nodes prescribe **reason-oriented activities** (e.g., clarification, evaluation, revision, verification), not task execution or procedural steps.

The fundamental unit of IRG computation is a **reasoning-bound primitive**, not a unit of work, job, or task.

Systems that model reasoning solely as procedural workflows, task graphs, or orchestration pipelines—without explicit, revisable reasoning primitives—do **not** satisfy IRG compliance

A system **MAY** describe itself as IRG-compliant if—and only if—it satisfies **all** of the following:

### **8.1 Persistent Reasoning Structure**

The system must represent reasoning as an explicit structure that persists beyond a single inference or response.

* Reasoning artifacts must survive across iterations.  
* Reasoning must not be reducible to the ephemeral prompt state alone.

### **8.2 Executable Reasoning Nodes**

The system must represent reasoning steps as executable units (nodes) that:

* encode intent or goal,  
* produce outputs that affect future computation,  
* may invoke models, tools, or memory.

Nodes must be capable of being re-executed, revised, or invalidated.

### **8.3 Explicit Dependency and Revision Relations**

The system must represent why reasoning steps exist via explicit relations, including at least one of:

* dependency,  
* refinement,  
* invalidation,  
* supersession.

Reasoning updates must be localized to affected subgraphs rather than requiring global regeneration.

### **8.4 Iterative Revision Capability**

The system must support iteration as a first-class operation, including:

* critique or evaluation of prior reasoning,  
* revision or qualification of prior nodes,  
* repeated execution until a termination condition is met.

Iteration must not be simulated solely through repeated prompting without structural state.

### **8.5 Inspectability and Trace Export**

The system must allow inspection of the reasoning structure sufficient to:

* identify reasoning steps,  
* observe revision history,  
* explain why a conclusion was reached or abandoned.

Full internal model state exposure is not required.

### **8.6 Termination Semantics**

The system must support explicit termination states, including at least one of:

* convergence,  
* bounded non-convergence,  
* abstention,  
* external approval,  
* budget exhaustion.

Failure to converge must be representable as a first-class outcome.

---

### **Non-Compliance**

Systems that rely solely on:

* linear chain-of-thought,  
* stateless self-critique loops,  
* prompt-only orchestration,  
* non-persistent tool workflows,

do not meet the criteria for IRG compliance, even if they exhibit iterative behavior.

---

## **9\. Outlook**

The Iterative Reasoning Graph reframes intelligence as **structured, persistent cognition**, not token prediction.

By separating:

* **Reasoning structure (IRG)**  
* **Memory**  
* **Generation** 

we enable systems that:

* Think longer than a single response  
* Explain *why* they answered  
* Improve without retraining  
* Operate efficiently on commodity hardware

IRGs are not an optimization.

They are a **new cognitive primitive**.


---

## **License**

The Iterative Reasoning Graphs (IRG) specification is licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0).

You are free to:

* Share — copy and redistribute the material in any medium or format  
* Adapt — remix, transform, and build upon the material  
* Use for any purpose, including commercial use

Under the following terms:

* Attribution — You must give appropriate credit, provide a link to the license, and indicate if changes were made.

This license applies to the specification text only. Reference implementations, tooling, datasets, and certification programs may be licensed separately.
