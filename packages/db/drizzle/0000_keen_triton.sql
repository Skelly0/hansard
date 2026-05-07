CREATE TABLE "favour_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favour_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"short_name" varchar(32),
	"description" text,
	"emoji" varchar(8),
	"colour" varchar(7),
	"spendable_on" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favour_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"type" varchar(32) NOT NULL,
	"reason" varchar(512),
	"granted_by_id" uuid,
	"sim_tick" integer,
	"sim_date" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_clock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"current_date" varchar(32) NOT NULL,
	"current_tick" integer DEFAULT 0 NOT NULL,
	"tick_unit" varchar(32) DEFAULT 'month' NOT NULL,
	"start_date" varchar(32) NOT NULL,
	"season_name" varchar(128) NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_advance_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_tick" integer NOT NULL,
	"to_tick" integer NOT NULL,
	"from_date" varchar(32) NOT NULL,
	"to_date" varchar(32) NOT NULL,
	"advanced_by_id" uuid NOT NULL,
	"summary" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"short_name" varchar(16),
	"description" text,
	"colour" varchar(7),
	"discord_role_id" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"start_date" timestamp DEFAULT now() NOT NULL,
	"end_date" timestamp,
	"appointed_by" uuid,
	"appointment_method" varchar(64) NOT NULL,
	"election_id" uuid,
	"removal_reason" varchar(256),
	"removed_by_id" uuid,
	"sim_tick" integer,
	"sim_date" varchar(32)
);
--> statement-breakpoint
CREATE TABLE "offices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"tier" varchar(32) NOT NULL,
	"faction_id" uuid,
	"max_holders" integer DEFAULT 1 NOT NULL,
	"permissions" jsonb,
	"filled_by" varchar(32) DEFAULT 'elected' NOT NULL,
	"appointable_by" uuid,
	"requires_confirmation" boolean DEFAULT false NOT NULL,
	"discord_role_id" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"short_name" varchar(16),
	"faction_id" uuid,
	"leader_id" uuid,
	"ideology" varchar(256),
	"colour" varchar(7),
	"discord_role_id" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"founded_at" timestamp DEFAULT now() NOT NULL,
	"dissolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "player_event_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"description" varchar(512) NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"sim_tick" integer,
	"sim_date" varchar(32),
	"triggered_by_id" uuid,
	"is_automatic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_id" varchar(20) NOT NULL,
	"discord_username" varchar(64) NOT NULL,
	"character_name" varchar(128),
	"character_bio" text,
	"character_portrait_url" varchar(512),
	"faction_id" uuid,
	"party_id" uuid,
	"birth_date" varchar(32),
	"starting_age" integer,
	"current_age" integer,
	"death_date" varchar(32),
	"cause_of_death" varchar(256),
	"is_alive" boolean DEFAULT true NOT NULL,
	"health_status" varchar(32) DEFAULT 'healthy' NOT NULL,
	"ailments" jsonb DEFAULT '[]'::jsonb,
	"starting_favours_granted" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_staff" boolean DEFAULT false NOT NULL,
	"staff_role" varchar(64),
	"registered_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp,
	"profile_data" jsonb,
	CONSTRAINT "players_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(64) NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" text,
	"emoji" varchar(8),
	"colour" varchar(7),
	"assignable_roles" jsonb DEFAULT '[]'::jsonb,
	"custom_pipeline" jsonb,
	"form_template" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"discord_message_id" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"category_id" uuid NOT NULL,
	"created_by_id" uuid NOT NULL,
	"assigned_to_id" uuid,
	"title" varchar(256) NOT NULL,
	"description" text NOT NULL,
	"form_data" jsonb,
	"status" varchar(32) DEFAULT 'open' NOT NULL,
	"priority" varchar(16) DEFAULT 'normal' NOT NULL,
	"parent_ticket_id" uuid,
	"linked_ticket_ids" jsonb DEFAULT '[]'::jsonb,
	"discord_channel_id" varchar(20),
	"discord_thread_id" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"first_response_at" timestamp,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	"tags" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "bill_status_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"from_status" varchar(32),
	"to_status" varchar(32) NOT NULL,
	"changed_by_id" uuid NOT NULL,
	"notes" text,
	"sim_tick" integer,
	"sim_date" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(256) NOT NULL,
	"short_title" varchar(64),
	"slug" varchar(256) NOT NULL,
	"bill_number" serial NOT NULL,
	"google_doc_url" varchar(512) NOT NULL,
	"google_doc_id" varchar(128),
	"cached_content" text,
	"cached_at" timestamp,
	"summary" text,
	"author_id" uuid NOT NULL,
	"submitted_by_id" uuid NOT NULL,
	"co_sponsor_ids" jsonb DEFAULT '[]'::jsonb,
	"status" varchar(32) DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"player_vote_id" uuid,
	"player_vote_result" varchar(16),
	"player_vote_at" timestamp,
	"npc_vote_required" boolean DEFAULT true NOT NULL,
	"npc_vote" jsonb,
	"enacted_at" timestamp,
	"effective_at" timestamp,
	"repealed_at" timestamp,
	"repealed_by_bill_id" uuid,
	"collection_id" uuid,
	"parent_document_id" uuid,
	"amends_bill_id" uuid,
	"amends_document_id" uuid,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"policy_areas" jsonb DEFAULT '[]'::jsonb,
	"cross_references" jsonb DEFAULT '[]'::jsonb,
	"estimated_effects" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "document_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" varchar(32) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content" text NOT NULL,
	"change_description" varchar(512),
	"edited_by_id" uuid NOT NULL,
	"amendment_bill_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"slug" varchar(256) NOT NULL,
	"content" text,
	"google_doc_url" varchar(512),
	"cached_content" text,
	"cached_at" timestamp,
	"parent_document_id" uuid,
	"hierarchy_level" integer DEFAULT 0 NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"author_id" uuid,
	"access_level" varchar(16) DEFAULT 'public' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "documents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ballots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"election_id" uuid NOT NULL,
	"voter_id" uuid NOT NULL,
	"vote" jsonb NOT NULL,
	"cast_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"election_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"party_id" uuid,
	"statement" text,
	"nominated_by_id" uuid,
	"is_withdrawn" boolean DEFAULT false NOT NULL,
	"registered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "elections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"type" varchar(32) NOT NULL,
	"method" varchar(32) NOT NULL,
	"required_permission" varchar(32),
	"config" jsonb NOT NULL,
	"for_office_id" uuid,
	"npc_confirmation" jsonb,
	"parent_election_id" uuid,
	"round_number" integer DEFAULT 1 NOT NULL,
	"nominations_open_at" timestamp,
	"nominations_close_at" timestamp,
	"voting_opens_at" timestamp NOT NULL,
	"voting_closes_at" timestamp NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"results" jsonb,
	"related_bill_id" uuid,
	"created_by_id" uuid NOT NULL,
	"discord_message_id" varchar(20),
	"discord_channel_id" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_player_id" uuid NOT NULL,
	"moderator_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"reason" text NOT NULL,
	"internal_notes" text,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"appeal_status" varchar(16),
	"appeal_reason" text,
	"appeal_reviewed_by_id" uuid,
	"ticket_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_player_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "favour_balances" ADD CONSTRAINT "favour_balances_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favour_balances" ADD CONSTRAINT "favour_balances_category_id_favour_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."favour_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favour_transactions" ADD CONSTRAINT "favour_transactions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favour_transactions" ADD CONSTRAINT "favour_transactions_category_id_favour_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."favour_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favour_transactions" ADD CONSTRAINT "favour_transactions_granted_by_id_players_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_advance_log" ADD CONSTRAINT "time_advance_log_advanced_by_id_players_id_fk" FOREIGN KEY ("advanced_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_holders" ADD CONSTRAINT "office_holders_office_id_offices_id_fk" FOREIGN KEY ("office_id") REFERENCES "public"."offices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_holders" ADD CONSTRAINT "office_holders_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_holders" ADD CONSTRAINT "office_holders_appointed_by_players_id_fk" FOREIGN KEY ("appointed_by") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_holders" ADD CONSTRAINT "office_holders_removed_by_id_players_id_fk" FOREIGN KEY ("removed_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_appointable_by_offices_id_fk" FOREIGN KEY ("appointable_by") REFERENCES "public"."offices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_leader_id_players_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_event_log" ADD CONSTRAINT "player_event_log_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_event_log" ADD CONSTRAINT "player_event_log_triggered_by_id_players_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_audit_log" ADD CONSTRAINT "ticket_audit_log_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_audit_log" ADD CONSTRAINT "ticket_audit_log_actor_id_players_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_players_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_id_ticket_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ticket_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_id_players_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_id_players_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parent_ticket_id_tickets_id_fk" FOREIGN KEY ("parent_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_status_log" ADD CONSTRAINT "bill_status_log_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_status_log" ADD CONSTRAINT "bill_status_log_changed_by_id_players_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_author_id_players_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_submitted_by_id_players_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_repealed_by_bill_id_bills_id_fk" FOREIGN KEY ("repealed_by_bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_collection_id_document_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."document_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_parent_document_id_documents_id_fk" FOREIGN KEY ("parent_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_amends_bill_id_bills_id_fk" FOREIGN KEY ("amends_bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_edited_by_id_players_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_amendment_bill_id_bills_id_fk" FOREIGN KEY ("amendment_bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_collection_id_document_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."document_collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_parent_document_id_documents_id_fk" FOREIGN KEY ("parent_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_author_id_players_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_voter_id_players_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_nominated_by_id_players_id_fk" FOREIGN KEY ("nominated_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_for_office_id_offices_id_fk" FOREIGN KEY ("for_office_id") REFERENCES "public"."offices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_parent_election_id_elections_id_fk" FOREIGN KEY ("parent_election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elections" ADD CONSTRAINT "elections_created_by_id_players_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_actions" ADD CONSTRAINT "mod_actions_target_player_id_players_id_fk" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_actions" ADD CONSTRAINT "mod_actions_moderator_id_players_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_actions" ADD CONSTRAINT "mod_actions_appeal_reviewed_by_id_players_id_fk" FOREIGN KEY ("appeal_reviewed_by_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_actions" ADD CONSTRAINT "mod_actions_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_notes" ADD CONSTRAINT "mod_notes_target_player_id_players_id_fk" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_notes" ADD CONSTRAINT "mod_notes_author_id_players_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "favour_balances_player_category_unique" ON "favour_balances" USING btree ("player_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ballots_election_voter_unique" ON "ballots" USING btree ("election_id","voter_id");