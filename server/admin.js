import { z } from "zod";
import { Op } from "sequelize";
import { db, models as M } from "./db.js";
import {
  requirePermission,
  permissionsSchema,
  fail,
  plain,
  audit,
  idSchema,
  pagination,
} from "./core.js";

export function adminAccess(ctx) {
  requirePermission(ctx, "admin");
  if (ctx.permissions.scope !== "all")
    fail(403, "Administration requires access to all departments.");
}
const userSchema = z.object({
  uin: z.string().regex(/^\d{9}$/),
  netid: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/),
  email: z.email().max(255),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  role_id: idSchema,
  department_id: idSchema,
  is_active: z.boolean().default(true),
});
const departmentSchema = z.object({
  dept_code: z.string().trim().min(1).max(50),
  dept_name: z.string().trim().min(1).max(255),
  parent_department_id: idSchema.nullable().optional().default(null),
  is_workspace: z.boolean().default(true),
  is_active: z.boolean().default(true),
});
const accountSchema = z.object({
  account_code: z.string().trim().min(1).max(50),
  category_name: z.string().trim().min(1).max(255),
  group_type: z.string().trim().min(1).max(100),
});
const roleSchema = z.object({
  role_name: z.string().trim().min(1).max(100),
  permissions: permissionsSchema,
});
export async function saveAdmin(ctx, type, raw, id) {
  adminAccess(ctx);
  requirePermission(ctx, "admin", true);
  const schemas = {
    users: userSchema,
    departments: departmentSchema,
    accounts: accountSchema,
    roles: roleSchema,
  };
  const input = schemas[type].parse(raw),
    table = type === "accounts" ? "banner_accounts" : type;
  return db.transaction(async (transaction) => {
    // Serialize identity/role changes, including protection of the administrator account.
    await db.query(
      "INSERT INTO transaction_locks (lock_key, updated_at) VALUES (?, NOW()) ON DUPLICATE KEY UPDATE updated_at = updated_at",
      { replacements: ["administration"], transaction },
    );
    await M.transaction_locks.findByPk("administration", {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const row = id
      ? await M[table].findByPk(type === "accounts" ? id : idSchema.parse(id), {
          transaction,
        })
      : null;
    if (id && !row) fail(404, "Record not found.");
    const before = plain(row);
    if (type === "users") {
      const role = await M.roles.findByPk(input.role_id, { transaction });
      const dept = await M.departments.findByPk(input.department_id, {
        transaction,
      });
      if (!role || !dept?.is_active)
        fail(400, "Choose an existing role and active department.");
      if (
        Number(id) === ctx.user.id &&
        (!input.is_active ||
          input.role_id !== ctx.user.role_id ||
          input.department_id !== ctx.user.department_id)
      )
        fail(
          409,
          "You cannot disable your own account or change its role or department.",
        );
    }
    if (type === "departments") {
      if (input.parent_department_id) {
        const parent = await M.departments.findByPk(
          input.parent_department_id,
          { transaction },
        );
        if (
          !parent ||
          parent.parent_department_id ||
          parent.is_workspace ||
          parent.id === Number(id)
        )
          fail(400, "The parent must be a top-level department container.");
      }
      const children = id
        ? await M.departments.count({
            where: { parent_department_id: id },
            transaction,
          })
        : 0;
      if (
        children &&
        (input.parent_department_id || input.is_workspace || !input.is_active)
      )
        fail(
          409,
          "A container with children must remain active and top-level.",
        );
      if (
        id &&
        !input.is_active &&
        (await M.users.count({
          where: { department_id: id, is_active: true },
          transaction,
        }))
      )
        fail(
          409,
          "Reassign or disable active users before deactivating their department.",
        );
    }
    let data = input;
    if (type === "roles") {
      if (row?.is_system)
        fail(409, "System roles are protected. Create a custom role instead.");
      if (
        row?.id === ctx.user.role_id &&
        (input.permissions.admin !== "write" ||
          input.permissions.scope !== "all")
      )
        fail(409, "You cannot remove your own administrative access.");
      data = {
        role_name: input.role_name,
        permissions_json: JSON.stringify(input.permissions),
        is_system: false,
      };
    }
    if (type === "accounts" && id && input.account_code !== id)
      fail(400, "An account code cannot be changed.");
    const result = row
      ? await row.update(data, { transaction })
      : await M[table].create(data, { transaction });
    await audit(
      ctx,
      id ? "update" : "create",
      table,
      before,
      result,
      transaction,
    );
    return result;
  });
}
export async function adminData(ctx, query) {
  adminAccess(ctx);
  const p = pagination(query);
  const where = query.q
    ? {
        [Op.or]: ["first_name", "last_name", "netid", "email"].map((k) => ({
          [k]: { [Op.like]: `%${String(query.q).slice(0, 100)}%` },
        })),
      }
    : {};
  const users = await M.users.findAndCountAll({
    where,
    order: [["id", "ASC"]],
    limit: p.limit,
    offset: p.offset,
  });
  return {
    users: {
      rows: users.rows,
      total: users.count,
      page: p.page,
      limit: p.limit,
    },
    roles: await M.roles.findAll({ order: [["id", "ASC"]] }),
    departments: await M.departments.findAll({ order: [["dept_name", "ASC"]] }),
    accounts: await M.banner_accounts.findAll({
      order: [["account_code", "ASC"]],
    }),
  };
}
