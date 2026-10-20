-- TEST ONLY: created inside the isolated mad_browser_test_* database. Never apply to Neon.
CREATE TABLE mad_booking_analytics(booking_id uuid,check_in_date date,status text,updated_at timestamptz DEFAULT now());
CREATE TABLE payments(payment_id uuid PRIMARY KEY,payment_status text,amount bigint,paid_at timestamptz);
CREATE TABLE kms_food_orders(order_id uuid PRIMARY KEY,status text,placed_at timestamptz,updated_at timestamptz);
CREATE TABLE kms_food_order_items(order_id uuid,menu_item_id uuid,name text,quantity integer,updated_at timestamptz);
CREATE TABLE wkms_tasks(task_id uuid PRIMARY KEY,assigned_worker_id uuid,status text,submitted_at timestamptz,completed_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE foss_complaints(complaint_id uuid PRIMARY KEY,referenced_worker_id uuid,status text,submitted_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE foss_service_requests(request_id uuid PRIMARY KEY,status text,submitted_at timestamptz,completed_at timestamptz,updated_at timestamptz);
CREATE TABLE mad_occupancy_rooms(room_id text,active_from date,active_to date,updated_at timestamptz DEFAULT now());
CREATE TABLE mad_occupancy_allocations(room_id text,check_in_date date,check_out_date date,status text,updated_at timestamptz DEFAULT now());
CREATE TABLE mad_occupancy_maintenance(room_id text,start_date date,end_date date,updated_at timestamptz DEFAULT now());
INSERT INTO mad_booking_analytics VALUES(gen_random_uuid(),(now() AT TIME ZONE 'Asia/Colombo')::date,'CONFIRMED',now());
INSERT INTO payments VALUES(gen_random_uuid(),'COMPLETED',10000,now());
INSERT INTO kms_food_orders VALUES('67f4568c-89ab-4c12-b321-123456789012','PLACED',now(),now());
INSERT INTO kms_food_order_items VALUES('67f4568c-89ab-4c12-b321-123456789012',gen_random_uuid(),'Soup',2,now());
INSERT INTO foss_service_requests VALUES(gen_random_uuid(),'COMPLETED',now()-interval '1 hour',now(),now());
