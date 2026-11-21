# AGENT INSTRUCTIONS — WOW FOREVER FARM OPTIMIZER

## General Rules

1. Read PROJECT_SPEC.md completely before starting development.
2. Treat PROJECT_SPEC.md as the primary product specification.
3. Do not implement features without understanding the existing architecture.
4. Prioritize functional features over visual demonstrations.
5. Never fabricate API responses, drop rates, market prices, or historical data.
6. Clearly distinguish real, estimated, simulated, and unavailable data.
7. Use modular, maintainable, strongly typed code.
8. Never expose API keys, secrets, or credentials in frontend code.
9. Write tests for all important business logic.
10. Document architectural decisions and external API limitations.

## Development Workflow

- Start by researching the available data sources.
- Verify API documentation before implementing integrations.
- Present the proposed architecture before major implementation.
- Implement incrementally.
- Test every major feature.
- Keep documentation updated.
- Maintain a working application throughout development.

## Critical Business Logic

The profitability engine is the core of this project.

Never simplify the economic calculations by considering only the most valuable item.

Consider all relevant loot drops, Auction House fees, market liquidity, estimated selling probability, farming speed, and expenses.

Never confuse statistical expected value with guaranteed earnings.

## Code Quality

- TypeScript strict mode.
- Proper error handling.
- Input validation.
- Reusable components.
- Modular data providers.
- Automated tests.
- No unnecessary dependencies.

## Communication

Before each development phase:
1. Explain what will be implemented.
2. Identify dependencies and potential problems.
3. Explain how completion will be validated.

## OTHER RULES

If my request is ambiguous, ask one clarifying question before doing anything." Most of my worst outputs came from it confidently sprinting in the wrong direction. One quick question up front saves way more back-and-forth than it costs. 

Don't trust assumptions when verifiable information exists. Assess confidence before acting: 

explicitly state all assumptions used in the response.

When making claims, distinguish clearly between: Verifiable evidence (cite sources when possible), and Architectural reasoning 

Preplan your tool calls, and group in batches where it makes sense, wait for them to all. return before reading any.

Human readability isn't the goal, prioritize for adherence and token consumption 

## GitHub Integration — Mandatory

Before development, read GIT_WORKFLOW.md.

GitHub version control is a mandatory part of this project.

Every completed development task must be committed and pushed to the configured GitHub repository according to GIT_WORKFLOW.md.

Never consider a development task fully completed until its Git status has been reviewed and its changes have been successfully synchronized with GitHub.

Keep the project documentation synchronized with implementation changes.



Do not silently skip requirements.

When encountering unavailable APIs or undocumented endpoints, investigate alternatives and report the limitation rather than inventing an integration.