const mdDiff = require('@ads-vdh/md-diff');

// Simulate the exact scenario
const original = `The misuse of antibiotics in viral infections contributes to antibiotic resistance. sources_needed:
- Centers for Disease Control and Prevention (CDC)
- World Health Organization (WHO) overall confidence: 0.8 caveats:
- This response focuses on the general effectiveness of antibiotics against viral infections.
- Local regulations and specific guidelines may vary, alternative_interpretations:
- Understanding the role of antibiotics in bacterial infections.
- Exploring alternative treatments for viral infections.

## Why Antibiotics Are Not Effective Against Viral Infections

Antibiotics are medications designed to target and kill bacteria, not viruses. The effectiveness of antibiotics against viral infections is a common misconception. When antibiotics are used to treat viral infections, such as the common cold or flu, they do not provide any significant benefits and can even cause harm.

## Mechanism of Action

Antibiotics work by either inhibiting the synthesis of essential bacterial components or interfering with the bacterial cell wall, ultimately leading to the death of the bacterial cell. Since viruses do not have a cell wall and do not synthesize their own components, antibiotics are ineffective against them.`;

const revised = `The misuse of antibiotics in viral infections contributes to antibiotic resistance. sources_needed:
- Centers for Disease Control and Prevention (CDC)
- World Health Organization (WHO) overall confidence: 0.8 caveats:
- This response focuses on the general effectiveness of antibiotics against viral infections.
- Local regulations and specific guidelines may vary, alternative_interpretations:
- Understanding the role of antibiotics in bacterial infections.
- Exploring alternative treatments for viral infections.

## Why Antibiotics Are Not Effective Against Viral Infections

Antibiotics are medications designed to target and kill bacteria, not viruses. The effectiveness of antibiotics against viral infections is a common misconception. When antibiotics are used to treat viral infections, such as the common cold or flu, they do not provide any significant benefits and can even cause harm.

## Mechanism of Action

Antibiotics work by either inhibiting the synthesis of essential bacterial components or interfering with the bacterial cell wall, ultimately leading to the death of the bacterial cell. Since viruses do not have a cell wall and do not synthesize their own components, antibiotics are ineffective against them.`;

const result = mdDiff(original, revised);
console.log('Original length:', original.length);
console.log('Revised length:', revised.length);
console.log('Are they equal?', original === revised);
console.log('Diff result:', result);
