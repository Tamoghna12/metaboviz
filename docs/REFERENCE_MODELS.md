# Reference Models

**Supported model formats, standards, and reference models for MetabolicSuite**

---

## Table of Contents

- [SBML Format](#sbml-format)
- [COBRApy JSON Format](#cobra-json-format)
- [Model Specifications](#model-specifications)
- [Reference Models](#reference-models)
- [Model Validation](#model-validation)
- [Best Practices](#best-practices)

---

## SBML Format

### Supported SBML Levels

| Level | Version | FBC Package | Notes |
|-------|---------|------------|-------|
| **Level 2** | Version 4 | None | Legacy but widely used |
| **Level 3** | Version 1 | FBC v2 | Current standard |
| **Level 3** | Version 2 | FBC v2 | Current standard |

### SBML Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">
  <model id="model_id" name="Model Name">
    
    <!-- List of compartments -->
    <listOfCompartments>
      <compartment id="c" name="cytosol" size="1"/>
      <compartment id="e" name="extracellular" size="1000"/>
    </listOfCompartments>
    
    <!-- List of species (metabolites) -->
    <listOfSpecies>
      <species id="glc__D_c" name="Glucose" compartment="c" 
             charge="0" chemicalFormula="C6H12O6"/>
      <species id="pyr_c" name="Pyruvate" compartment="c" 
             charge="-1" chemicalFormula="C3H3O3"/>
      <species id="atp_c" name="ATP" compartment="c" 
             charge="-4" chemicalFormula="C10H16N5O13"/>
    </listOfSpecies>
    
    <!-- List of parameters -->
    <listOfParameters>
      <parameter id="kcat" value="100" constant="true"/>
      <parameter id="kgdh" value="0.05" constant="true"/>
    </listOfParameters>
    
    <!-- List of reactions -->
    <listOfReactions>
      <reaction id="R_GLCPTS" name="Glucose PTS Transporter" reversible="false" fast="false">
        <listOfReactants>
          <speciesReference species="glc__D_e" stoichiometry="1"/>
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="glc__D_c" stoichiometry="-1"/>
        </listOfProducts>
        
        <!-- Gene-Protein-Reaction rule -->
        <annotation>
          <rdf:RDF>
            <rdf:Description rdf:parseType="String">
              Glucose PTS transporter (complex of IICD subunits)
            </rdf:Description>
            <bqbiol:is>GeneProduct rdf:parseType="Resource">b0001</bqbiol:is>GeneProduct></bqbiol:is>GeneProduct>
            <fbc:geneProduct>b0001</fbc:geneProduct>
          </rdf:RDF>
        </annotation>
      </reaction>
      
      <!-- Biomass reaction -->
      <reaction id="BIOMASS_Ec" name="Biomass" reversible="false">
        <listOfReactants>
          <speciesReference species="atp_c" stoichiometry="-1"/>
          <speciesReference species="o2_c" stoichiometry="-0.1"/>
        </listOfReactants>
        <annotation>
          <fbc:objective rdf:parseType="String">BIOMASS</fbc:objective>
        </annotation>
        <kineticLaw>
          <math xmlns="http://www.sbml.org/sbml/mathml">
            <apply>
              <ci>0.1 * atp_c * 0.05</ci>
              <ci>0.1 * o2_c * -0.02</ci>
            </apply>
          </math>
        </kineticLaw>
      </reaction>
    </listOfReactions>
  </model>
</sbml>
```

### FBC Package (Flux Balance Constraints)

**Purpose**: Encodes flux balance analysis information directly in SBML.

**Required Elements**:
1. **Flux Bound References**:
   ```xml
   <reaction id="R_AKGDH">
     <fbc:lowerFluxBound>fb_lower</fbc:lowerFluxBound>
     <fbc:upperFluxBound>fb_upper</fbc:upperFluxBound>
   </reaction>
   ```

2. **Gene Product Associations**:
   ```xml
   <reaction id="R_PFK">
     <fbc:geneProduct>b0001</fbc:geneProduct>
     <fbc:geneAssociation>
       <fbc:geneProductRef>b0001</fbc:geneProductRef>
       <fbc:geneProductRef>b0002</fbc:geneProductRef>
     </fbc:geneAssociation>
   </reaction>
   ```

3. **Chemical Formulas**:
   ```xml
   <species id="glc__D_c">
     <fbc:chemicalFormula>C6H12O6</fbc:chemicalFormula>
   </species>
   ```

---

## COBRApy JSON Format

### Standard COBRApy Model JSON Structure

```json
{
  "id": "iML1515",
  "name": "Escherichia coli iML1515",
  "compartments": {
    "c": "cytosol",
    "e": "extracellular",
    "p": "periplasm"
  },
  "metabolites": {
    "glc__D_c": {
      "name": "Glucose",
      "compartment": "c",
      "formula": "C6H12O6",
      "charge": 0
    },
    "pyr_c": {
      "name": "Pyruvate",
      "compartment": "c",
      "formula": "C3H3O3",
      "charge": -1
    }
  },
  "reactions": {
    "R_GLCPTS": {
      "name": "Glucose PTS Transporter",
      "metabolites": {
        "glc__D_e": -1,
        "glc__D_c": 1
      },
      "lower_bound": -1000,
      "upper_bound": 0,
      "gene_reaction_rule": "b3916 or b1723",
      "genes": ["b3916", "b1723"]
    },
    "BIOMASS_Ec": {
      "name": "Biomass (Ec)",
      "metabolites": {
        "atp_c": -0.5,
        "o2_c": -0.2,
        "h2o_c": -0.5,
        "co2_c": -0.2,
        "co2_e": 0.2
      },
      "lower_bound": 0,
      "upper_bound": 1000,
      "objective_coefficient": 1
    }
  },
  "genes": {
    "b3916": {
      "name": "pfkA",
      "id": "b0001",
      "essential": false
    },
    "b1723": {
      "name": "pfkB",
      "id": "b0002",
      "essential": false
    }
  }
}
```

### Field Descriptions

| Field | Description | Type | Required | Notes |
|-------|-------------|----------|-------|-------|
| **id** | Unique model identifier | String | Yes | Must match file name (without extension) |
| **name** | Human-readable model name | String | Yes | Used for display |
| **compartments** | Cellular compartments | Object | No (default cytosol/extracellular) |
| **metabolites** | Metabolite definitions | Object | Yes | Must include formula, charge, compartment |
| **reactions** | Reaction definitions | Object | Yes | Must include stoichiometry, bounds, GPR |
| **genes** | Gene annotations | Object | No | Optional, includes essentiality |

### GPR Field Format

**Gene-Protein-Reaction Rule**:

Supported patterns:
```text
# Simple (single gene)
geneA

# OR (isozymes)
geneA or geneB or geneC

# AND (enzyme complex)
geneA and geneB

# Complex (nested)
(geneA and geneB) or (geneC and geneD)

# Nested with precedence
geneA and (geneB or geneC) and geneD
```

**In SBML (FBC v2)**:
```xml
<reaction id="R_PFK">
  <fbc:geneProductAssociation>
    <fbc:geneProductRef>b0001</fbc:geneProductRef>
    <fbc:geneProductRef>b0002</fbc:geneProductRef>
  </fbc:geneProductAssociation>
</reaction>
```

**In COBRApy JSON**:
```json
{
  "reactions": {
    "R_PFK": {
      "gene_reaction_rule": "b3916 or b1723",
      "genes": ["b3916", "b1723"]
    }
  }
}
```

---

## Model Specifications

### Required Elements

**1. Stoichiometry**
- Each reaction must balance (sum of coefficients = 0)
- Atoms must be conserved across network

**2. Metabolites**
- Must have unique IDs
- Must specify compartment
- Should include chemical formula (optional but recommended)

**3. Reactions**
- Must have reactants and products
- Must specify reversibility
- Must have bounds (lower, upper)

**4. Genes**
- Must have unique IDs
- If GPR rules exist, genes must be referenced

**5. Objective**
- Must define biomass reaction
- Set objective coefficient to 1.0

### Best Practices

**Stoichiometric Balance Verification**:
```javascript
function verifyStoichiometry(model) {
  const imbalances = [];
  
  // For each metabolite
  Object.entries(model.metabolites).forEach(([metId, met]) => {
    const imbalance = model.reactions.reduce((sum, rxn) => {
      const coeff = rxn.metabolites[metId] || 0;
      return sum + coeff;
    }, 0);
    
    // Imbalance > 1e-6 indicates error
    if (Math.abs(imbalance) > 1e-6) {
      imbalances.push({ metId, imbalance });
    }
  });
  
  return {
    valid: imbalances.length === 0,
    imbalances
  };
}
```

**Bounds Consistency**:
```javascript
function verifyBounds(model) {
  const issues = [];
  
  Object.entries(model.reactions).forEach(([rxnId, rxn]) => {
    const lb = rxn.lower_bound ?? -1000;
    const ub = rxn.upper_bound ?? 1000;
    
    if (lb > ub) {
      issues.push({
        reaction: rxnId,
        type: 'invalid_bounds',
        message: `Lower bound (${lb}) exceeds upper bound (${ub})`
      });
    }
    
    // Irreversible reaction with wrong sign
    if (!rxn.reversible && rxn.lower_bound < 0) {
      issues.push({
        reaction: rxnId,
        type: 'inconsistent_reversibility',
        message: 'Irreversible reaction has negative lower bound'
      });
    }
  });
  
  return {
    valid: issues.length === 0,
    issues
  };
}
```

**GPR Coverage**:
```javascript
function verifyGPRCoverage(model) {
  const genes = new Set(Object.keys(model.genes));
  const coveredGenes = new Set();
  
  let reactionsWithGPR = 0;
  let genesWithGPR = 0;
  
  Object.values(model.reactions).forEach(rxn => {
    if (rxn.gene_reaction_rule && rxn.gene_reaction_rule.trim() !== '') {
      reactionsWithGPR++;
      
      // Extract genes from GPR
      const gprGenes = rxn.genes || [];
      gprGenes.forEach(g => coveredGenes.add(g));
    }
  });
  
  return {
    totalGenes: genes.size,
    reactionsWithGPR,
    genesWithGPR: genesWithGPR.size,
    coverage: genesWithGPR / totalGenes,
    reactionsWithGPR: reactionsWithGPR / Object.keys(model.reactions).length
  };
}
```

---

## Reference Models

### E. coli Models

#### iML1515 (Most Comprehensive)

**Source**: Monk et al. (2017) Nature Biotechnology 35:904-908

**Specifications**:
- **Reactions**: 2712
- **Metabolites**: 1877
- **Genes**: 1515
- **Compartmentments**: c (cytosol), e (extracellular)
- **Download**: https://bigg.ucsd.edu/escherichiacoli/models/iML1515

**Expected FBA Results** (Minimal M9, 10 mmol/gDW/h glucose):
- **Growth rate**: 0.877 h⁻¹
- **Glucose uptake**: 10 mmol/gDW/h
- **Oxygen uptake**: 20 mmol/gDW/h

#### iJO1366 (Standard)

**Source**: Orth et al. (2011) Molecular Systems Biology 7:441

**Specifications**:
- **Reactions**: 2258
- **Metabolites**: 1668
- **Genes**: 1367
- **Download**: https://bigg.ucsd.edu/escherichiacoli/models/iJO1366

**Expected FBA Results** (Minimal M9, 10 mmol/gDW/h glucose):
- **Growth rate**: 0.737 h⁻¹
- **Glucose uptake**: 10 mmol/gDW/h
- **Oxygen uptake**: 20 mmol/gDW/h

#### Core Model (Educational)

**Purpose**: Teaching and demonstration

**Specifications**:
- **Reactions**: 95
- **Metabolites**: 72
- **Genes**: 30
- **Pathways**: Glycolysis, TCA cycle, PPP, overflow metabolism

**Expected FBA Results** (Minimal M9, 10 mmol/gDW/h glucose):
- **Growth rate**: 0.8 h⁻¹
- **Glucose uptake**: 10 mmol/gDW/h
- **Oxygen uptake**: 20 mmol/gDW/h

### S. cerevisiae Models

#### iMM904

**Source**: Nooka et al. (2015) FEMS Yeast 8:113

**Specifications**:
- **Reactions**: 1577
- **Metabolites**: 1226
- **Genes**: 904
- **Download**: https://bigg.ucsd.edu/scerevisiae/models/iMM904

#### iFF708

**Source**: Förster et al. (2003) PNAS 100:8930-8931

**Specifications**:
- **Reactions**: 708
- **Metabolites**: 636
- **Genes**: 708
- **Download**: https://bigg.ucsd.edu/scerevisiae/models/iFF708

### Human Models

#### Recon3D

**Source: Brunk et al. (2022) Cell Reports 31:609

**Specifications**:
- **Reactions**: 13488
- **Metabolites**: 8222
- **Genes**: ~5000 (estimated)
- **Compartmentments**: 11+ (cytosol, mitochondria, etc.)

### Bacterial Models

#### iAF1260

**Source**: Feist & Palsson (2007) Molecular Systems Biology 3:121

**Specifications**:
- **Reactions**: 2382
- **Metabolites**: 1668
- **Genes**: 1260

#### iND750

**Source**: Henry et al. (2010) Molecular Systems Biology 6:463

**Specifications**:
- **Reactions**: 750
- **Metabolites**: 620

---

## Model Validation

### Automated Validation Tests

#### Test Suite Integration

Run validation after model loading:
```javascript
// In ModelUpload.jsx
import { verifyStoichiometry, verifyBounds, verifyGPRCoverage } from '../utils/modelValidation';

const validation = verifyModel(parsedModel);

if (!validation.valid) {
  console.error('Model validation failed:', validation.imbalances);
  alert(`Model has ${validation.imbalances.length} stoichiometric imbalances`);
}
```

#### Validation Checks

**Stoichiometric Balance**:
```javascript
// Check each metabolite's mass balance
const checkMetaboliteBalance = (metId, model) => {
  let sum = 0;
  
  Object.values(model.reactions).forEach(rxn => {
    const coeff = rxn.metabolites[metId];
    if (coeff) {
      sum += coeff;
    }
  });
  
  return Math.abs(sum) < 1e-6;  // Allow small numerical errors
};
```

**Gene Reference Consistency**:
```javascript
// Check if all referenced genes exist in model
const checkGeneReferences = (model) => {
  const modelGenes = new Set(Object.keys(model.genes));
  const referencedGenes = new Set();
  
  Object.values(model.reactions).forEach(rxn => {
    if (rxn.gene_reaction_rule) {
      const genes = extractGenesFromGPR(rxn.gene_reaction_rule);
      genes.forEach(g => referencedGenes.add(g));
    }
  });
  
  const missingGenes = [...referencedGenes].filter(g => !modelGenes.has(g));
  
  return {
    valid: missingGenes.length === 0,
    missingGenes
  };
};
```

**Bounds Validation**:
```javascript
// Check for inconsistent bounds
const checkBounds = (model) => {
  const issues = [];
  
  Object.entries(model.reactions).forEach(([rxnId, rxn]) => {
    if (!rxn.reversible && rxn.lower_bound < 0) {
      issues.push({
        reaction: rxnId,
        type: 'invalid_irreversible_sign',
        message: `Irreversible reaction has negative lower bound: ${rxn.lower_bound}`
      });
    }
    
    if (rxn.lower_bound > rxn.upper_bound) {
      issues.push({
        reaction: rxnId,
        type: 'invalid_bounds',
        message: `Lower bound (${rxn.lower_bound}) exceeds upper bound (${rxn.upper_bound})`
      });
    }
  });
  
  return {
    valid: issues.length === 0,
    issues
  };
};
```

---

## Best Practices

### Model Creation

**1. Start Simple**:
- Begin with core metabolism
- Add pathways incrementally
- Test each before expanding

**2. Use Standard Identifiers**:
- BiGG database IDs for genes/metabolites
- Consistent naming conventions
- Avoid special characters

**3. Complete Annotations**:
- Add chemical formulas to metabolites
- Include GPR rules for all reactions
- Annotate compartments
- Add subsystem/pathway information

**4. Verify Constraints**:
- Check for mass balance
- Validate all bounds
- Ensure at least one exchange reaction

**5. Test Extensively**:
- Run FBA on multiple conditions
- Verify flux distributions make biological sense
- Compare to published results if available

### Model Documentation

**Include**:
- **Purpose**: Research use, teaching, demo
- **Source**: Data sources, publications
- **Limitations**: Known restrictions or approximations
- **Validation**: Test results, expected behaviors

**Example**:
```markdown
## Model Purpose

This model represents core E. coli metabolism for educational purposes.

## Data Sources

- Primary: Orth et al. (2010) Nat Biotechnol 28:245-248
- Secondary: BiGG Models database

## Limitations

- Simplified pathways (no alternative routes shown)
- Approximate kinetic parameters (used in educational FBA simulation)
- Not suitable for quantitative predictions

## Validation

Expected FBA results (glucose minimal media, 10 mmol/gDW/h):
- Growth rate: ~0.8 h⁻¹
- Biomass production: 0.8 h⁻¹
- ATP production: 35 mmol/gDW/h
```

### File Organization

**Directory Structure**:
```
models/
├── ecoli/
│   ├── iML1515.xml
│   ├── iJO1366.xml
│   └── core/educational.xml
├── yeast/
│   ├── iMM904.xml
│   └── iFF708.xml
└── human/
    └── Recon3D.xml
```

---

## Metadata Standards

### Required Metadata

```json
{
  "model": {
    "id": "unique_id",
    "name": "Human-readable name",
    "organism": "Escherichia coli",
    "version": "1.0",
    "date_created": "2025-01-01",
    "authors": ["Author Name", "Co-Author"],
    "publication": "DOI or reference",
    "license": "CC-BY-4.0"
  },
  "biology": {
    "compartment_model": "5-compartment",
    "growth_conditions": ["aerobic", "anaerobic"],
    "temperature": 37,
    "ph": 7.0",
    "objective": "Biomass maximization"
  },
  "methodology": {
    "solver": "GLPK linear programming",
    "fba_formulation": "Standard FBA",
    "bounds_source": "Literature values"
  }
}
```

---

## Conversion Guide

### SBML → COBRApy JSON

**Purpose**: Convert SBML models to COBRApy JSON format

**Implementation**:
```javascript
import { parseSBML } from '../utils/sbmlParser';

async function convertSBMLtoJSON(sbmlString) {
  const model = parseSBML(sbmlString);
  
  // Convert to COBRApy format
  const cobraFormat = {
    id: model.id,
    name: model.name,
    compartments: model.compartments,
    metabolites: model.metabolites,
    reactions: model.reactions,
    genes: model.genes
  };
  
  return cobraFormat;
}
```

### COBRApy JSON → SBML

**Implementation**:
```javascript
// Simplified conversion (full SBML writer is complex)
function convertJSONtoSBML(cobraModel) {
  const sbmlString = `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core">
  <model id="${cobraModel.id}" name="${cobraModel.name}">
    <listOfCompartments>
      ${Object.entries(cobraModel.compartments).map(([id, comp]) => `
        <compartment id="${id}" name="${comp.name}" size="${comp.size}"/>
      `).join('')}
    </listOfCompartments>
    
    <listOfSpecies>
      ${Object.entries(cobraModel.metabolites).map(([id, met]) => `
        <species id="${id}" name="${met.name}" compartment="${met.compartment}">
          <fbc:chemicalFormula>${met.formula}</fbc:chemicalFormula>
        </species>
      `).join('')}
    </listOfSpecies>
    
    <listOfReactions>
      ${Object.entries(cobraModel.reactions).map(([id, rxn]) => `
        <reaction id="${id}" name="${rxn.name}" reversible="${rxn.reversible ? "true" : "false"} fast="${rxn.fast ? 'true' : 'false'}">
          <listOfReactants>
            ${Object.entries(rxn.metabolites).map(([metId, coeff]) => `
              <speciesReference species="${metId}" stoichiometry="${coeff}"/>
            `).join('')}
          </listOfReactants>
          
          <listOfProducts>
            ${Object.entries(rxn.metabolites).map(([metId, coeff]) => `
              <speciesReference species="${metId}" stoichiometry="${coeff}"/>
            `).join('')}
          </listOfProducts>
          
          <fbc:geneProductAssociation>
            ${rxn.genes.map(gene => `
              <fbc:geneProductRef gene="${gene}" />
            `).join('')}
          </fbc:geneProductAssociation>
          
          <fbc:lowerFluxBound>${rxn.lower_bound}</fbc:lowerFluxBound>
          <fbc:upperFluxBound>${rxn.upper_bound}</fbc:upperFluxBound>
          
          <fbc:objectiveCoeffcient>${rxn.objective_coefficient || 0}</fbc:objectiveCoefficient>
        </reaction>
      `).join('')}
    </listOfReactions>
  </model>
</sbml>`;
  
  return sbmlString;
}
```

---

## Common Issues and Solutions

### Issue: Stoichiometric Imbalance

**Diagnosis**:
```
Metabolite 'NADH' has net production: 0.5
Total production: 1.5
Total consumption: 1.0
Imbalance: +0.5
```

**Solution**: Fix stoichiometric coefficients in reaction definitions.

### Issue: Missing Exchange Reactions

**Symptoms**:
- FBA returns infeasible
- All exchange reactions have bounds of 0
- Cannot import substrate

**Solution**: Add exchange reactions with appropriate bounds:
```javascript
// Add glucose exchange
model.reactions['EX_glc__D_e'] = {
  name: 'Glucose exchange',
  metabolites: { glc__D_e: 1 },
  lower_bound: -10,
  upper_bound: 0
};
```

### Issue: Infinite Growth

**Symptoms**:
- Growth rate > 10 h⁻¹ (biologically impossible)
- All fluxes at upper bounds

**Solution**: Add constraints or check bounds:
```javascript
// Add growth limit
model.reactions['BIOMASS'].upper_bound = 1.0;  // 1/h max
```

### Issue: All Reactions Blocked

**Symptoms**:
- All fluxes are zero
- Status: OPTIMAL but objective = 0

**Causes**:
- No biomass reaction
- No exchange reactions with uptake
- All reactions blocked by GPR knockouts

**Solution**: Ensure at least one active pathway exists.

---

*Last Updated: December 25, 2025*
