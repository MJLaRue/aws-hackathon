
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `SequelizeMeta` (
  `name` varchar(255) NOT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `actor_uin` varchar(50) DEFAULT NULL,
  `action_type` varchar(100) NOT NULL,
  `target_table` varchar(100) NOT NULL,
  `record_id` int DEFAULT NULL,
  `department_id` int DEFAULT NULL,
  `account_code` varchar(50) DEFAULT NULL,
  `fiscal_year` int DEFAULT NULL,
  `changes_json` longtext,
  `timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `audit_logs_idx_0` (`department_id`,`account_code`,`fiscal_year`,`timestamp`),
  KEY `audit_logs_idx_1` (`timestamp`),
  CONSTRAINT `audit_logs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `banner_accounts` (
  `account_code` varchar(50) NOT NULL,
  `category_name` varchar(255) NOT NULL,
  `group_type` varchar(100) NOT NULL,
  PRIMARY KEY (`account_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `budget_adjustment_drafts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `source_adjustment_id` int DEFAULT NULL,
  `draft_action` enum('create','update','delete') NOT NULL,
  `department_id` int NOT NULL,
  `account_code` varchar(50) NOT NULL,
  `fiscal_year` int NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `adjustment_type` varchar(100) NOT NULL,
  `obligation_status` varchar(100) DEFAULT NULL,
  `description` varchar(500) DEFAULT NULL,
  `created_by_user_id` int DEFAULT NULL,
  `updated_by_user_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `source_snapshot_hash` varchar(64) DEFAULT NULL,
  `status` enum('pending','expired') NOT NULL DEFAULT 'pending',
  `expired_at` datetime DEFAULT NULL,
  `expiration_reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `budget_adjustment_drafts_idx_0` (`source_adjustment_id`,`status`),
  KEY `account_code` (`account_code`),
  KEY `budget_adjustment_drafts_idx_1` (`department_id`,`fiscal_year`,`status`),
  CONSTRAINT `budget_adjustment_drafts_ibfk_1` FOREIGN KEY (`source_adjustment_id`) REFERENCES `budget_adjustments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `budget_adjustment_drafts_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `budget_adjustment_drafts_ibfk_3` FOREIGN KEY (`account_code`) REFERENCES `banner_accounts` (`account_code`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `budget_adjustments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `department_id` int NOT NULL,
  `account_code` varchar(50) NOT NULL,
  `fiscal_year` int NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `adjustment_type` varchar(100) NOT NULL,
  `obligation_status` varchar(100) DEFAULT NULL,
  `description` varchar(500) DEFAULT NULL,
  `reference_source` varchar(255) DEFAULT NULL,
  `reference_id` int DEFAULT NULL,
  `created_by_user_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL,
  `updated_by_user_id` int DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `deleted_by_user_id` int DEFAULT NULL,
  `is_draft` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `account_code` (`account_code`),
  KEY `created_by_user_id` (`created_by_user_id`),
  KEY `updated_by_user_id` (`updated_by_user_id`),
  KEY `deleted_by_user_id` (`deleted_by_user_id`),
  KEY `budget_adjustments_idx_0` (`department_id`,`fiscal_year`,`deleted_at`),
  KEY `budget_adjustments_idx_1` (`adjustment_type`,`obligation_status`),
  CONSTRAINT `budget_adjustments_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `budget_adjustments_ibfk_2` FOREIGN KEY (`account_code`) REFERENCES `banner_accounts` (`account_code`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `budget_adjustments_ibfk_3` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `budget_adjustments_ibfk_4` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `budget_adjustments_ibfk_5` FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=63 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `budget_bases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `department_id` int NOT NULL,
  `account_code` varchar(50) NOT NULL,
  `fiscal_year` int NOT NULL,
  `base_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `budget_bases_idx_0` (`department_id`,`account_code`,`fiscal_year`),
  KEY `account_code` (`account_code`),
  KEY `budget_bases_idx_1` (`department_id`,`fiscal_year`),
  CONSTRAINT `budget_bases_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `budget_bases_ibfk_2` FOREIGN KEY (`account_code`) REFERENCES `banner_accounts` (`account_code`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=121 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `departments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dept_code` varchar(50) NOT NULL,
  `dept_name` varchar(255) NOT NULL,
  `parent_department_id` int DEFAULT NULL,
  `is_workspace` tinyint(1) NOT NULL DEFAULT '1',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `dept_code` (`dept_code`),
  KEY `parent_department_id` (`parent_department_id`),
  CONSTRAINT `departments_ibfk_1` FOREIGN KEY (`parent_department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `faculty_members` (
  `id` char(36) NOT NULL,
  `uin` varchar(9) DEFAULT NULL,
  `display_name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uin` (`uin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `faculty_salaries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `department_id` int NOT NULL,
  `faculty_id` char(36) NOT NULL,
  `faculty_name` varchar(255) NOT NULL,
  `previous_salary` decimal(14,2) NOT NULL,
  `salary_increase` decimal(14,2) NOT NULL,
  `new_salary` decimal(14,2) NOT NULL,
  `fiscal_year` int NOT NULL,
  `rolled_over_from_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by_user_id` int DEFAULT NULL,
  `updated_by_user_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `faculty_salaries_idx_0` (`faculty_id`,`department_id`,`fiscal_year`),
  UNIQUE KEY `rolled_over_from_id` (`rolled_over_from_id`),
  KEY `created_by_user_id` (`created_by_user_id`),
  KEY `updated_by_user_id` (`updated_by_user_id`),
  KEY `faculty_salaries_idx_1` (`department_id`,`fiscal_year`),
  CONSTRAINT `faculty_salaries_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `faculty_salaries_ibfk_2` FOREIGN KEY (`faculty_id`) REFERENCES `faculty_members` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `faculty_salaries_ibfk_3` FOREIGN KEY (`rolled_over_from_id`) REFERENCES `faculty_salaries` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faculty_salaries_ibfk_4` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faculty_salaries_ibfk_5` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=62 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `faculty_salary_rollovers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `source_salary_id` int NOT NULL,
  `target_salary_id` int DEFAULT NULL,
  `source_fiscal_year` int NOT NULL,
  `target_fiscal_year` int NOT NULL,
  `department_id` int NOT NULL,
  `status` varchar(50) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `source_salary_id` (`source_salary_id`),
  UNIQUE KEY `target_salary_id` (`target_salary_id`),
  KEY `department_id` (`department_id`),
  CONSTRAINT `faculty_salary_rollovers_ibfk_1` FOREIGN KEY (`source_salary_id`) REFERENCES `faculty_salaries` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `faculty_salary_rollovers_ibfk_2` FOREIGN KEY (`target_salary_id`) REFERENCES `faculty_salaries` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `faculty_salary_rollovers_ibfk_3` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fiscal_year_expenses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `department_id` int NOT NULL,
  `account_code` varchar(50) NOT NULL,
  `fiscal_year` int NOT NULL,
  `expense_date` date NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `description` varchar(500) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by_user_id` int DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `updated_by_user_id` int DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `deleted_by_user_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `account_code` (`account_code`),
  KEY `created_by_user_id` (`created_by_user_id`),
  KEY `updated_by_user_id` (`updated_by_user_id`),
  KEY `deleted_by_user_id` (`deleted_by_user_id`),
  KEY `fiscal_year_expenses_idx_0` (`department_id`,`fiscal_year`,`deleted_at`),
  KEY `fiscal_year_expenses_idx_1` (`expense_date`),
  CONSTRAINT `fiscal_year_expenses_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fiscal_year_expenses_ibfk_2` FOREIGN KEY (`account_code`) REFERENCES `banner_accounts` (`account_code`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fiscal_year_expenses_ibfk_3` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fiscal_year_expenses_ibfk_4` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fiscal_year_expenses_ibfk_5` FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1125 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fiscal_year_rollovers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `source_fiscal_year` int NOT NULL,
  `target_fiscal_year` int NOT NULL,
  `budget_base_count` int NOT NULL DEFAULT '0',
  `faculty_salary_count` int NOT NULL DEFAULT '0',
  `completed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `staff_salary_count` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `fiscal_year_rollovers_idx_0` (`source_fiscal_year`,`target_fiscal_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fiscal_year_states` (
  `fiscal_year` int NOT NULL,
  `status` enum('active','archived') NOT NULL DEFAULT 'active',
  `archived_at` datetime DEFAULT NULL,
  `rolled_to_fiscal_year` int DEFAULT NULL,
  PRIMARY KEY (`fiscal_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `import_previews` (
  `token_hash` varchar(64) NOT NULL,
  `import_type` enum('adjustments','faculty_salaries','staff_salaries') NOT NULL,
  `user_id` int NOT NULL,
  `department_id` int DEFAULT NULL,
  `fiscal_year` int NOT NULL,
  `workspace_mode` enum('active','draft') NOT NULL,
  `context_hash` varchar(64) NOT NULL,
  `payload_json` longtext NOT NULL,
  `dataset_fingerprint` varchar(64) DEFAULT NULL,
  `status` enum('pending','consumed','stale','expired') NOT NULL DEFAULT 'pending',
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `consumed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `user_id` (`user_id`),
  KEY `department_id` (`department_id`),
  KEY `import_previews_idx_0` (`expires_at`,`status`),
  CONSTRAINT `import_previews_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `import_previews_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `line_notes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `department_id` int NOT NULL,
  `account_code` varchar(50) NOT NULL,
  `fiscal_year` int NOT NULL,
  `note_text` text NOT NULL,
  `created_by_user_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_resolved` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `account_code` (`account_code`),
  KEY `created_by_user_id` (`created_by_user_id`),
  KEY `line_notes_idx_0` (`department_id`,`account_code`,`fiscal_year`,`is_resolved`),
  CONSTRAINT `line_notes_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `line_notes_ibfk_2` FOREIGN KEY (`account_code`) REFERENCES `banner_accounts` (`account_code`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `line_notes_ibfk_3` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `role_name` varchar(100) NOT NULL,
  `permissions_json` text,
  `is_system` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_name` (`role_name`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saml_requests` (
  `request_id` varchar(255) NOT NULL,
  `issued_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime NOT NULL,
  `validation_state` varchar(20) NOT NULL DEFAULT 'pending',
  `validation_token` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`request_id`),
  KEY `saml_requests_idx_0` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sessions` (
  `sid` varchar(128) NOT NULL,
  `expires_at` datetime NOT NULL,
  `data` longtext NOT NULL,
  PRIMARY KEY (`sid`),
  KEY `sessions_idx_0` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_members` (
  `id` char(36) NOT NULL,
  `uin` varchar(9) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uin` (`uin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_salaries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `department_id` int NOT NULL,
  `staff_id` char(36) NOT NULL,
  `staff_name` varchar(255) NOT NULL,
  `previous_salary` decimal(14,2) NOT NULL,
  `salary_increase` decimal(14,2) NOT NULL,
  `new_salary` decimal(14,2) NOT NULL,
  `fiscal_year` int NOT NULL,
  `rolled_over_from_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by_user_id` int DEFAULT NULL,
  `updated_by_user_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `staff_salaries_idx_0` (`staff_id`,`department_id`,`fiscal_year`),
  UNIQUE KEY `rolled_over_from_id` (`rolled_over_from_id`),
  KEY `created_by_user_id` (`created_by_user_id`),
  KEY `updated_by_user_id` (`updated_by_user_id`),
  KEY `staff_salaries_idx_1` (`department_id`,`fiscal_year`),
  CONSTRAINT `staff_salaries_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `staff_salaries_ibfk_2` FOREIGN KEY (`staff_id`) REFERENCES `staff_members` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `staff_salaries_ibfk_3` FOREIGN KEY (`rolled_over_from_id`) REFERENCES `staff_salaries` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `staff_salaries_ibfk_4` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `staff_salaries_ibfk_5` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=61 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `staff_salary_rollovers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `source_salary_id` int NOT NULL,
  `target_salary_id` int DEFAULT NULL,
  `source_fiscal_year` int NOT NULL,
  `target_fiscal_year` int NOT NULL,
  `department_id` int NOT NULL,
  `status` varchar(50) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `source_salary_id` (`source_salary_id`),
  UNIQUE KEY `target_salary_id` (`target_salary_id`),
  KEY `department_id` (`department_id`),
  CONSTRAINT `staff_salary_rollovers_ibfk_1` FOREIGN KEY (`source_salary_id`) REFERENCES `staff_salaries` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `staff_salary_rollovers_ibfk_2` FOREIGN KEY (`target_salary_id`) REFERENCES `staff_salaries` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `staff_salary_rollovers_ibfk_3` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transaction_locks` (
  `lock_key` varchar(191) NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`lock_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `uin` varchar(9) NOT NULL,
  `netid` varchar(50) NOT NULL,
  `email` varchar(255) NOT NULL,
  `first_name` varchar(100) NOT NULL,
  `last_name` varchar(100) NOT NULL,
  `role_id` int NOT NULL,
  `department_id` int NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uin` (`uin`),
  UNIQUE KEY `netid` (`netid`),
  UNIQUE KEY `email` (`email`),
  KEY `role_id` (`role_id`),
  KEY `department_id` (`department_id`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `users_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
