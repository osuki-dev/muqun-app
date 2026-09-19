import { create } from 'zustand';

import { homeAttentionState, type HomeAttentionState } from '@/lib/home-attention';

export const useHomeAttention = create<HomeAttentionState>(homeAttentionState);
