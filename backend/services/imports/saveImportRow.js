/**
 * Validates and prepares import changes separately from applying them.
 *
 * Prepared changes are internal server data, never browser input.
 * An optional session remains supported during the migration.
 */

import { isDeepStrictEqual } from "node:util";

import { requireDecimal } from "../../utils/decimal.js";
import { RequestValidationError } from "../../utils/requestValidation.js";

import { getImportEntity } from "./importRegistry.js";
import { normalizeImportRow } from "./normalizeImportRow.js";
import { validateImportReferences } from "./validateImportReferences.js";

const protectedRelationships = Object.freeze({
  menu_variants: ["menu_item_id"],
  menu_recipes: ["menu_item_id", "menu_variant_id", "ingredient_id"],
  historical_sales: ["restaurant_id", "menu_item_id", "menu_variant_id"],
  inventory_batches_expiry: ["restaurant_id", "ingredient_id"],
  suppliers: ["supplier_id", "ingredient_id"],
  promotion_history: ["menu_item_id", "menu_variant_id"],
});

export class ImportWriteConflictError extends Error {
  constructor() {
    super(
      "The record changed during import processing. Review the current record before retrying.",
    );
    this.name = "ImportWriteConflictError";
  }
}

function valuesMatch(left, right) {
  if (left?._bsontype === "Decimal128" && right?._bsontype === "Decimal128") {
    return requireDecimal(left).equals(requireDecimal(right));
  }

  return isDeepStrictEqual(left, right);
}

/**
 * Match the document exactly as it was read.
 *
 * Missing fields are distinguished from fields explicitly set to null.
 */
export function buildImportSnapshotFilter(document, sourceFields) {
  return {
    _id: document._id,
    $and: sourceFields.map((fieldName) =>
      Object.hasOwn(document, fieldName)
        ? {
            [fieldName]: {
              $exists: true,
              $eq: document[fieldName],
            },
          }
        : {
            [fieldName]: { $exists: false },
          },
    ),
  };
}

async function validateCandidate(document) {
  try {
    await document.validate();
  } catch (error) {
    if (error.name === "ValidationError") {
      throw new RequestValidationError(
        `Row validation failed for fields: ${Object.keys(error.errors).join(
          ", ",
        )}.`,
      );
    }

    throw error;
  }
}

/**
 * Validate a row and describe the intended change.
 *
 * This function does not write business data.
 * BSON values such as ObjectId and Decimal128 are retained.
 */
export async function prepareImportRow(
  entityName,
  input,
  { restaurantId, allowCorrections = false, session = null } = {},
) {
  if (typeof allowCorrections !== "boolean") {
    throw new Error("allowCorrections must be a Boolean.");
  }

  const entity = getImportEntity(entityName);

  const { row, keyFilter } = await normalizeImportRow(entityName, input);

  const existing = await entity.model
    .findOne(keyFilter)
    .session(session)
    .lean();

  if (!existing) {
    const document = new entity.model(row);

    await validateCandidate(document);

    const preparedDocument = document.toObject({
      transform: false,
    });

    await validateImportReferences(
      entityName,
      preparedDocument,
      restaurantId,
      session,
    );

    return {
      entityName,
      outcome: "inserted",
      keyFilter,
      before: null,
      after: preparedDocument,
      updateFields: null,
    };
  }

  const candidate = new entity.model({
    ...existing,
    ...row,
  });

  await validateCandidate(candidate);

  await validateImportReferences(
    entityName,
    candidate.toObject({ transform: false }),
    restaurantId,
    session,
  );

  const changedFields = {};

  for (const fieldName of Object.keys(row)) {
    const candidateValue = candidate.get(fieldName);

    if (!valuesMatch(existing[fieldName], candidateValue)) {
      changedFields[fieldName] = candidateValue;
    }
  }

  if (Object.keys(changedFields).length === 0) {
    return {
      entityName,
      outcome: "skipped",
      keyFilter,
      before: existing,
      after: existing,
      updateFields: null,
    };
  }

  if (!allowCorrections) {
    throw new RequestValidationError(
      "The business key already exists with different values. Enable corrections to update it.",
    );
  }

  const protectedFields = [
    ...entity.keyFields,
    ...(protectedRelationships[entityName] ?? []),
  ];

  if (
    protectedFields.some((fieldName) => Object.hasOwn(changedFields, fieldName))
  ) {
    throw new RequestValidationError(
      "This import cannot change an existing record's protected relationship.",
    );
  }

  return {
    entityName,
    outcome: "updated",
    keyFilter,
    before: existing,

    // Include only the changes we actually intend to write.
    after: {
      ...existing,
      ...changedFields,
    },

    updateFields: changedFields,
  };
}

/**
 * Applies one previously validated change.
 *
 * This function does not update import receipts or job counters.
 * The caller will coordinate those through the recovery record.
 */
export async function applyPreparedImportRow(
  prepared,
  { session = null } = {},
) {
  const entity = getImportEntity(prepared.entityName);
  const options = session ? { session } : {};

  if (prepared.outcome === "skipped") {
    return {
      outcome: "skipped",
      keyFilter: prepared.keyFilter,
    };
  }

  if (prepared.outcome === "inserted") {
    // The prepared document already contains its generated _id.
    // Retaining that identity will help distinguish a recovered insert.
    await entity.model.collection.insertOne(prepared.after, options);

    return {
      outcome: "inserted",
      keyFilter: prepared.keyFilter,
    };
  }

  if (prepared.outcome !== "updated") {
    throw new Error("Unsupported prepared import outcome.");
  }

  const result = await entity.model.collection.updateOne(
    buildImportSnapshotFilter(prepared.before, entity.sourceFields),
    {
      $set: prepared.updateFields,
    },
    options,
  );

  if (result.matchedCount !== 1) {
    throw new ImportWriteConflictError();
  }

  return {
    outcome: "updated",
    keyFilter: prepared.keyFilter,
  };
}

/**
 * Compatibility wrapper for current callers.
 *
 * The standalone row processor will call prepare and apply separately,
 * storing the prepared change before applying it.
 */
export async function saveImportRow(entityName, input, options = {}) {
  const prepared = await prepareImportRow(entityName, input, options);

  return applyPreparedImportRow(prepared, options);
}
