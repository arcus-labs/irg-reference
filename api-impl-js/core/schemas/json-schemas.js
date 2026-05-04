/**
 * JSON Schemas for IRG Node Responses
 * 
 * Defines JSON schemas for Groq API structured output.
 * Each schema ensures the LLM returns valid, parseable JSON.
 */

const schemas = {
  clarify: {
    name: 'clarify_response',
    schema: {
      type: 'object',
      properties: {
        core_concepts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              term: { type: 'string' },
              recognized: { type: 'boolean' },
              notes: { type: 'string' }
            },
            required: ['term', 'recognized', 'notes'],
            additionalProperties: false
          },
          description: 'Core concepts the question depends on'
        },
        premise_type: {
          type: 'string',
          enum: ['valid', 'ambiguous', 'false_premise', 'fabricated_premise'],
          description: 'Classification of the query premise'
        },
        premise_explanation: {
          type: 'string',
          description: 'Explanation of the premise classification'
        },
        ambiguities: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of ambiguities in the query'
        },
        missing_context: {
          type: 'array',
          items: { type: 'string' },
          description: 'Missing context needed to answer the query'
        },
        assumptions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Assumptions being made'
        },
        scope_assessment: {
          type: 'string',
          description: 'Assessment of query scope clarity'
        },
        failure_modes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Detected failure modes that downstream nodes must respect'
        },
        salvageable_core: {
          type: 'string',
          description: 'Legitimate remainder of the query, if any'
        },
        invalid_components: {
          type: 'array',
          items: { type: 'string' },
          description: 'Invalid parts of the query that must not be laundered'
        },
        dangerous_terms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Terms or phrases that must not be treated as established'
        },
        clarification_questions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Questions to clarify the query'
        },
        can_proceed: {
          type: 'boolean',
          description: 'Whether downstream nodes have enough grounding to continue'
        },
        early_exit: {
          type: 'boolean',
          description: 'Whether the current signals strongly suggest stopping before a substantive answer'
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence in the analysis (0-1)'
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of the analysis'
        }
      },
      required: ['core_concepts', 'premise_type', 'premise_explanation', 'ambiguities', 'missing_context', 'assumptions', 'scope_assessment', 'failure_modes', 'salvageable_core', 'invalid_components', 'dangerous_terms', 'clarification_questions', 'can_proceed', 'early_exit', 'confidence', 'reasoning'],
      additionalProperties: false
    }
  },

  adversary: {
    name: 'adversary_response',
    schema: {
      type: 'object',
      properties: {
        weak_assumptions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Assumptions that are likely wrong or unverifiable'
        },
        strategy_flaws: {
          type: 'array',
          items: { type: 'string' },
          description: 'Problems with the proposed approach'
        },
        recommended_adjustments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Recommended adjustments to improve the strategy'
        },
        laundering_risks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Places where the strategy may launder invalid framing as real'
        },
        blueprint_gaps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Missing guardrails or structural weaknesses in the blueprint'
        },
        counter_blueprint: {
          type: 'object',
          properties: {
            use_counter_blueprint: { type: 'boolean' },
            reason: { type: 'string' },
            response_policy: {
              type: 'object',
              properties: {
                policy: { type: 'string' },
                rationale: { type: 'string' },
                delivery_goal: { type: 'string' },
                delivery_variant: { type: 'string' }
              },
              required: ['policy', 'rationale'],
              additionalProperties: false
            },
            section_plan: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tag: { type: 'string' },
                  goal: { type: 'string' },
                  instruction: { type: 'string' },
                  reasoning: { type: 'string' },
                  preferred_content: {
                    type: 'array',
                    items: { type: 'string' }
                  },
                  forbidden_content: {
                    type: 'array',
                    items: { type: 'string' }
                  },
                  tone_notes: { type: 'string' }
                },
                required: ['tag', 'goal', 'reasoning'],
                additionalProperties: false
              }
            }
          },
          required: ['use_counter_blueprint', 'reason', 'response_policy', 'section_plan'],
          additionalProperties: false
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence in the critique (0-1)'
        }
      },
      required: ['weak_assumptions', 'strategy_flaws', 'recommended_adjustments', 'laundering_risks', 'blueprint_gaps', 'counter_blueprint', 'confidence'],
      additionalProperties: false
    }
  },

  strategy: {
    name: 'strategy_response',
    schema: {
      type: 'object',
      properties: {
        key_points: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key points to address'
        },
        structure: {
          type: 'array',
          items: { type: 'string' },
          description: 'Proposed structure for the response'
        },
        reasoning_approach: {
          type: 'string',
          description: 'How to approach the reasoning'
        },
        evidence_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Types of evidence to use'
        },
        response_policy: {
          type: 'object',
          properties: {
            policy: { type: 'string' },
            rationale: { type: 'string' },
            delivery_goal: { type: 'string' },
            delivery_variant: { type: 'string' }
          },
          required: ['policy', 'rationale'],
          additionalProperties: false
        },
        blueprint: {
          type: 'object',
          properties: {
            opening_act: { type: 'string' },
            nonsense_scope: { type: 'string' },
            invalid_scope: { type: 'string' },
            salvageable_core: { type: 'string' },
            closest_legitimate_frame: { type: 'string' },
            forbidden_moves: {
              type: 'array',
              items: { type: 'string' }
            },
            required_moves: {
              type: 'array',
              items: { type: 'string' }
            },
            engagement_variant: {
              type: 'object',
              properties: {
                style_handle: { type: 'string' },
                style_goal: { type: 'string' },
                hard_constraints: {
                  type: 'array',
                  items: { type: 'string' }
                }
              },
              required: ['style_handle', 'style_goal', 'hard_constraints'],
              additionalProperties: false
            },
            section_plan: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tag: { type: 'string' },
                  goal: { type: 'string' },
                  instruction: { type: 'string' },
                  reasoning: { type: 'string' },
                  preferred_content: {
                    type: 'array',
                    items: { type: 'string' }
                  },
                  forbidden_content: {
                    type: 'array',
                    items: { type: 'string' }
                  },
                  tone_notes: { type: 'string' }
                },
                required: ['tag', 'goal', 'instruction', 'reasoning', 'preferred_content', 'forbidden_content', 'tone_notes'],
                additionalProperties: false
              }
            }
          },
          required: ['forbidden_moves', 'required_moves', 'section_plan'],
          additionalProperties: false
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence in the strategy (0-1)'
        }
      },
      required: ['key_points', 'structure', 'reasoning_approach', 'evidence_types', 'response_policy', 'blueprint', 'confidence'],
      additionalProperties: false
    }
  },

  arbiter: {
    name: 'arbiter_response',
    schema: {
      type: 'object',
      properties: {
        synthesis: {
          type: 'string',
          description: 'How strategy and critique were synthesized'
        },
        final_strategy: {
          type: 'object',
          properties: {
            key_points: {
              type: 'array',
              items: { type: 'string' }
            },
            structure: {
              type: 'array',
              items: { type: 'string' }
            },
            reasoning_approach: { type: 'string' },
            evidence_types: {
              type: 'array',
              items: { type: 'string' }
            },
            response_policy: {
              type: 'object',
              properties: {
                policy: { type: 'string' },
                rationale: { type: 'string' },
                delivery_goal: { type: 'string' },
                delivery_variant: { type: 'string' }
              },
              required: ['policy', 'rationale'],
              additionalProperties: false
            },
            forbidden_moves: {
              type: 'array',
              items: { type: 'string' }
            },
            required_moves: {
              type: 'array',
              items: { type: 'string' }
            },
            section_plan: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tag: { type: 'string' },
                  goal: { type: 'string' },
                  instruction: { type: 'string' },
                  reasoning: { type: 'string' },
                  preferred_content: {
                    type: 'array',
                    items: { type: 'string' }
                  },
                  forbidden_content: {
                    type: 'array',
                    items: { type: 'string' }
                  },
                  tone_notes: { type: 'string' }
                },
                required: ['tag', 'goal', 'instruction', 'reasoning', 'preferred_content', 'forbidden_content', 'tone_notes'],
                additionalProperties: false
              }
            }
          },
          required: ['key_points', 'structure', 'reasoning_approach', 'evidence_types', 'response_policy', 'forbidden_moves', 'required_moves', 'section_plan'],
          additionalProperties: false
        },
        addressed_concerns: {
          type: 'array',
          items: { type: 'string' }
        },
        laundering_risks_resolved: {
          type: 'array',
          items: { type: 'string' }
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence in the synthesis (0-1)'
        }
      },
      required: ['synthesis', 'final_strategy', 'addressed_concerns', 'laundering_risks_resolved', 'confidence'],
      additionalProperties: false
    }
  },

  factCheck: {
    name: 'fact_check_response',
    schema: {
      type: 'object',
      properties: {
        critical_claims: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              claim: { type: 'string' },
              importance: { type: 'string' },
              assessment: { type: 'string', enum: ['true', 'false', 'uncertain'] },
              reasoning: { type: 'string' },
              source: {
                anyOf: [
                  { type: 'string' },
                  { type: 'null' }
                ]
              }
            },
            required: ['claim', 'importance', 'assessment', 'reasoning', 'source'],
            additionalProperties: false
          },
          description: 'Critical factual claims extracted from the strategy'
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Overall confidence in claim extraction (0-1)'
        }
      },
      required: ['critical_claims', 'confidence'],
      additionalProperties: false
    }
  },

  impact: {
    name: 'impact_response',
    schema: {
      type: 'object',
      properties: {
        implications: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key implications of the answer'
        },
        limitations: {
          type: 'array',
          items: { type: 'string' },
          description: 'Limitations of the analysis'
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence in impact assessment (0-1)'
        }
      },
      required: ['implications', 'limitations', 'confidence'],
      additionalProperties: false
    }
  },

  draft: {
    name: 'draft_response',
    schema: {
      type: 'object',
      properties: {
        response: {
          type: 'string',
          description: 'The drafted response to the query'
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence in the draft (0-1)'
        }
      },
      required: ['response', 'confidence'],
      additionalProperties: false
    }
  }
};

module.exports = schemas;

