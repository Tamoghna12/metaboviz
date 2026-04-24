import React, { createContext, useContext, useState, useCallback } from 'react';
import { parseModel } from '../utils/modelParser';
import { genes as defaultGenes, reactions as defaultReactions, nodes as defaultNodes, edges as defaultEdges } from '../data/metabolicData';

const ModelContext = createContext(undefined);

export const useModel = () => {
  const context = useContext(ModelContext);
  if (!context) {
    throw new Error('useModel must be used within a ModelProvider');
  }
  return context;
};

// Default E. coli core model (educational)
const DEFAULT_MODEL = {
  id: 'e_coli_core_edu',
  name: 'E. coli Core (Educational)',
  description: 'Simplified E. coli core metabolism for educational purposes',
  genes: defaultGenes,
  reactions: defaultReactions,
  nodes: defaultNodes,
  edges: defaultEdges,
  isDefault: true
};

export const ModelProvider = ({ children }) => {
  const [currentModel, setCurrentModel] = useState(DEFAULT_MODEL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadedModels, setUploadedModels] = useState([]);

  const loadModel = useCallback(async (file) => {
    setLoading(true);
    setError(null);

    try {
      const parsedModel = await parseModel(file);

      const model = {
        id: parsedModel.id || file.name.replace(/\.[^/.]+$/, ''),
        name: parsedModel.id || file.name,
        description: `Uploaded from ${file.name}`,
        genes: parsedModel.genes,
        reactions: parsedModel.reactions,
        metabolites: parsedModel.metabolites,
        nodes: parsedModel.nodes,
        edges: parsedModel.edges,
        isDefault: false,
        fileName: file.name,
        uploadedAt: Date.now()
      };

      setUploadedModels(prev => {
        // Replace if same ID exists
        const filtered = prev.filter(m => m.id !== model.id);
        return [...filtered, model];
      });

      setCurrentModel(model);
      setLoading(false);
      return model;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  }, []);

  const selectModel = useCallback((modelId) => {
    if (modelId === DEFAULT_MODEL.id) {
      setCurrentModel(DEFAULT_MODEL);
      return;
    }

    const model = uploadedModels.find(m => m.id === modelId);
    if (model) {
      setCurrentModel(model);
    }
  }, [uploadedModels]);

  const resetToDefault = useCallback(() => {
    setCurrentModel(DEFAULT_MODEL);
    setError(null);
  }, []);

  const removeModel = useCallback((modelId) => {
    setUploadedModels(prev => prev.filter(m => m.id !== modelId));
    if (currentModel.id === modelId) {
      setCurrentModel(DEFAULT_MODEL);
    }
  }, [currentModel.id]);

  // Model statistics
  const modelStats = {
    genes: Object.keys(currentModel.genes || {}).length,
    reactions: Object.keys(currentModel.reactions || {}).length,
    metabolites: Object.keys(currentModel.metabolites || {}).length,
    nodes: (currentModel.nodes || []).length,
    edges: (currentModel.edges || []).length
  };

  // Get available exchange reactions for constraint setup
  const exchangeReactions = Object.entries(currentModel.reactions || {})
    .filter(([id, r]) => id.startsWith('EX_') || r.subsystem === 'Exchange')
    .map(([id, r]) => ({ id, ...r }));

  // Get subsystems from reactions
  const subsystems = [...new Set(
    Object.values(currentModel.reactions || {}).map(r => r.subsystem).filter(Boolean)
  )].sort();

  const updateReactions = useCallback((updates) => {
    // updates: { rxnId: { lower_bound?, upper_bound?, gene_reaction_rule?, name?, subsystem? } }
    setCurrentModel(prev => ({
      ...prev,
      reactions: Object.fromEntries(
        Object.entries(prev.reactions || {}).map(([id, rxn]) =>
          updates[id] ? [id, { ...rxn, ...updates[id] }] : [id, rxn]
        )
      )
    }));
  }, []);

  const deleteReaction = useCallback((rxnId) => {
    setCurrentModel(prev => {
      const { [rxnId]: _removed, ...remaining } = prev.reactions || {};
      return { ...prev, reactions: remaining };
    });
  }, []);

  const patchModel = useCallback((changes) => {
    setCurrentModel(prev => ({ ...prev, ...changes }));
  }, []);

  const value = {
    currentModel,
    loading,
    error,
    uploadedModels,
    availableModels: [DEFAULT_MODEL, ...uploadedModels],
    loadModel,
    selectModel,
    resetToDefault,
    removeModel,
    updateReactions,
    deleteReaction,
    patchModel,
    modelStats,
    exchangeReactions,
    subsystems,
    isDefaultModel: currentModel.isDefault
  };

  return (
    <ModelContext.Provider value={value}>
      {children}
    </ModelContext.Provider>
  );
};
