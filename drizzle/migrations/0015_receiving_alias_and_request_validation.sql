-- Correct ambiguity found by executing real PostgreSQL transactions in isolated tests.
DO $repair$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.receive_operational_purchase(uuid,jsonb,text,text)'::regprocedure);
 IF position('jsonb_array_elements(_items) x GROUP BY x->>' IN definition)=0 THEN RAISE EXCEPTION 'unexpected_receiving_definition'; END IF;
 definition:=replace(definition,'jsonb_array_elements(_items) x GROUP BY x->>''itemId''','jsonb_array_elements(_items) AS receipt_element(value) GROUP BY receipt_element.value->>''itemId''');
 EXECUTE definition;
END $repair$;
-- Prevent missing/null scalars from bypassing PL/pgSQL comparisons.
DO $validation$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.save_operational_record(uuid,uuid,text,jsonb)'::regprocedure);
 definition:=replace(definition,'IF _kind=''inventory'' THEN','IF _kind=''inventory'' THEN IF NOT (_payload ? ''quantity'' AND _payload ? ''costCents'' AND _payload ? ''unit'') OR _payload->>''quantity'' IS NULL OR _payload->>''costCents'' IS NULL OR _payload->>''unit'' NOT IN(''oz'',''lb'',''gal'',''kg'',''units'',''pack'') THEN RAISE EXCEPTION ''invalid_inventory''; END IF;');
 EXECUTE definition;
END $validation$;
REVOKE ALL ON FUNCTION public.receive_operational_purchase(uuid,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_operational_purchase(uuid,jsonb,text,text) TO authenticated;