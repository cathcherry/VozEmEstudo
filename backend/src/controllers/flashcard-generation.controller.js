import { env } from '../config/env.js';
import { getOwnedMaterial } from '../repositories/material.repository.js';
import { getReviewState } from '../repositories/review.repository.js';
import { getVersion } from '../repositories/transcription.repository.js';
import { getAiRegistry } from '../ai/provider-registry.js';
import {
  buildFlashcardGenerationService, buildFlashcardGenerationServiceV2, mockFlashcardCompletionV2,
} from '../services/flashcard-generation.service.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { existingFronts } from '../repositories/flashcard-set.repository.js';

const generate = buildFlashcardGenerationService({
  getOwnedMaterial, getReviewState, getVersion,
  model: () => (env.mockExternalServices ? 'mock' : getAiRegistry().text('flashcards').model),
  complete: env.mockExternalServices
    ? async ({ messages }) => {
      const excerpt = JSON.parse(messages[1].content).transcript.slice(0, 250);
      return { cards: [{ front: 'Demonstração simulada: qual trecho consta na transcrição?',
        back: excerpt, evidence: excerpt }] };
    }
    : async (args) => (await getAiRegistry().text('flashcards').completeJson(args)).data,
});

const generateV2 = buildFlashcardGenerationServiceV2({
  getOwnedMaterial, getReviewState, getVersion, existingFronts,
  model: () => (env.mockExternalServices ? 'mock' : getAiRegistry().text('flashcards').model),
  complete: env.mockExternalServices
    ? mockFlashcardCompletionV2
    : async (args) => (await getAiRegistry().text('flashcards').completeJson(args)).data,
});

export async function preview(req, res, next) {
  try {
    // Requests with a config use Flashcards 2.0; the original contract stays unchanged.
    const v2 = isFeatureEnabled('flashcard_sets') && req.body && 'config' in req.body;
    res.json(await (v2 ? generateV2 : generate)(req.user.id, req.body));
  } catch (error) { next(error); }
}
