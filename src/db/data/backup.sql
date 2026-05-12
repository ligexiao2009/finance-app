--
-- PostgreSQL database dump
--

\restrict k28aPcK3JsKlGLCrGJe1Il7NloQqLFT7nL4pFeaYHn7GiCaZJw5fEd9At0Dg24G

-- Dumped from database version 16.13 (Postgres.app)
-- Dumped by pg_dump version 16.13 (Postgres.app)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Record; Type: TABLE; Schema: public; Owner: yangyang
--

CREATE TABLE public."Record" (
    id integer NOT NULL,
    type text NOT NULL,
    category text,
    amount double precision NOT NULL,
    note text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Record" OWNER TO yangyang;

--
-- Name: Record_id_seq; Type: SEQUENCE; Schema: public; Owner: yangyang
--

CREATE SEQUENCE public."Record_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Record_id_seq" OWNER TO yangyang;

--
-- Name: Record_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: yangyang
--

ALTER SEQUENCE public."Record_id_seq" OWNED BY public."Record".id;


--
-- Name: alert_rules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.alert_rules (
    id character varying(50) NOT NULL,
    position_id character varying(50) NOT NULL,
    direction character varying(5) NOT NULL,
    threshold numeric(5,2) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    triggered_today boolean DEFAULT false NOT NULL,
    trigger_time timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT alert_rules_direction_check CHECK (((direction)::text = ANY ((ARRAY['up'::character varying, 'down'::character varying, 'both'::character varying])::text[])))
);


ALTER TABLE public.alert_rules OWNER TO postgres;

--
-- Name: asset_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_records (
    id integer NOT NULL,
    recorded_at timestamp without time zone NOT NULL,
    total numeric(15,2) NOT NULL,
    alipay numeric(15,2) DEFAULT 0,
    wechat numeric(15,2) DEFAULT 0,
    ths numeric(15,2) DEFAULT 0,
    crypto numeric(15,2) DEFAULT 0,
    cmb numeric(15,2) DEFAULT 0,
    provident numeric(15,2) DEFAULT 0,
    receivable numeric(15,2) DEFAULT 0,
    debt numeric(15,2) DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.asset_records OWNER TO postgres;

--
-- Name: asset_records_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.asset_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.asset_records_id_seq OWNER TO postgres;

--
-- Name: asset_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.asset_records_id_seq OWNED BY public.asset_records.id;


--
-- Name: categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories (
    id character varying(50) NOT NULL,
    name character varying(50) NOT NULL,
    sort_order integer DEFAULT 0
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- Name: configs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.configs (
    key character varying(50) NOT NULL,
    value text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.configs OWNER TO postgres;

--
-- Name: daily_profits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.daily_profits (
    id integer NOT NULL,
    date date NOT NULL,
    stock_today numeric(15,2) DEFAULT 0 NOT NULL,
    fund_today numeric(15,2) DEFAULT 0 NOT NULL,
    total_today numeric(15,2) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.daily_profits OWNER TO postgres;

--
-- Name: daily_profits_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.daily_profits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.daily_profits_id_seq OWNER TO postgres;

--
-- Name: daily_profits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.daily_profits_id_seq OWNED BY public.daily_profits.id;


--
-- Name: daily_profits_summary; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.daily_profits_summary AS
 SELECT date,
    stock_today,
    fund_today,
    total_today,
    created_at
   FROM public.daily_profits
  ORDER BY date DESC;


ALTER VIEW public.daily_profits_summary OWNER TO postgres;

--
-- Name: pending_trades; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pending_trades (
    id character varying(50) NOT NULL,
    row_id character varying(50) NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    amount numeric(15,2) NOT NULL,
    is_before_15 boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone NOT NULL,
    type character varying(10) DEFAULT 'add'::character varying NOT NULL,
    shares numeric(15,4)
);


ALTER TABLE public.pending_trades OWNER TO postgres;

--
-- Name: positions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.positions (
    id character varying(50) NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    shares numeric(15,4) DEFAULT 0 NOT NULL,
    cost numeric(15,4) DEFAULT 0 NOT NULL,
    is_fund boolean DEFAULT false NOT NULL,
    is_overseas boolean DEFAULT false NOT NULL,
    plan_buy numeric(15,2) DEFAULT 0 NOT NULL,
    alert numeric(5,2),
    target_price numeric(15,4),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    category_id character varying(50)
);


ALTER TABLE public.positions OWNER TO postgres;

--
-- Name: positions_summary; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.positions_summary AS
 SELECT id,
    code,
    name,
    shares,
    cost,
    is_fund,
    is_overseas,
    plan_buy,
    alert,
    target_price,
    created_at,
    updated_at,
    (shares * cost) AS estimated_value
   FROM public.positions p
  ORDER BY code;


ALTER VIEW public.positions_summary OWNER TO postgres;

--
-- Name: trade_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.trade_history (
    id character varying(50) NOT NULL,
    row_id character varying(50) NOT NULL,
    type character varying(10) NOT NULL,
    amount numeric(15,2) NOT NULL,
    shares numeric(15,4) NOT NULL,
    net_value numeric(15,4) NOT NULL,
    is_before_15 boolean DEFAULT true,
    created_at timestamp without time zone NOT NULL,
    local_date date,
    CONSTRAINT trade_history_type_check CHECK (((type)::text = ANY ((ARRAY['add'::character varying, 'reduce'::character varying])::text[])))
);


ALTER TABLE public.trade_history OWNER TO postgres;

--
-- Name: Record id; Type: DEFAULT; Schema: public; Owner: yangyang
--

ALTER TABLE ONLY public."Record" ALTER COLUMN id SET DEFAULT nextval('public."Record_id_seq"'::regclass);


--
-- Name: asset_records id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_records ALTER COLUMN id SET DEFAULT nextval('public.asset_records_id_seq'::regclass);


--
-- Name: daily_profits id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_profits ALTER COLUMN id SET DEFAULT nextval('public.daily_profits_id_seq'::regclass);


--
-- Data for Name: Record; Type: TABLE DATA; Schema: public; Owner: yangyang
--

COPY public."Record" (id, type, category, amount, note, "createdAt") FROM stdin;
1	expense	餐饮美食	11	\N	2026-03-22 11:53:39
\.


--
-- Data for Name: alert_rules; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.alert_rules (id, position_id, direction, threshold, enabled, triggered_today, trigger_time, created_at, updated_at) FROM stdin;
1774959092085dwbt3hq7g	1774198708865v00xywl0e	both	3.00	f	f	\N	2026-04-08 02:06:52.612481	2026-04-08 02:06:52.612481
1774959095323qmg8s3q9x	1774198708865v00xywl0e	both	2.00	f	f	\N	2026-04-08 02:06:53.377859	2026-04-08 02:06:53.377859
1774959100622lznx8zqnj	1774198708865v00xywl0e	both	4.00	f	f	\N	2026-04-08 02:06:53.869668	2026-04-08 02:06:53.869668
1775103579216ixp48b9tz	1774432392200ul5es8ctm	both	3.00	f	f	\N	2026-04-02 04:23:41.605683	2026-04-02 04:23:41.605683
\.


--
-- Data for Name: asset_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_records (id, recorded_at, total, alipay, wechat, ths, crypto, cmb, provident, receivable, debt, created_at) FROM stdin;
27	2026-05-11 04:35:27.635	1448799.00	631251.00	70.00	766000.00	15500.00	1000.00	11000.00	24000.00	22.00	2026-05-11 12:35:27.637497
\.


--
-- Data for Name: categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.categories (id, name, sort_order) FROM stdin;
a_stock_large	A股大盘	1
us_stock	美股	4
index_fund	指数基金	5
sector_fund	行业基金	6
bond_fund	债券基金	7
hybrid_fund	混合基金	8
overseas_fund	海外基金	9
hk_stock	恒科	3
cxy	创新药	10
cpo	CPO	11
jiqiren	机器人	12
bdt	半导体	13
hongli	红利	14
aiyingyong	软件	15
a_stock_small	A股中小	2
\.


--
-- Data for Name: configs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.configs (key, value, created_at, updated_at) FROM stdin;
alertTime	0 31 23 * * *	2026-03-26 12:34:50.13386	2026-03-26 12:46:20.864506
editUnlockPassword	8957	2026-03-28 17:23:54.886524	2026-03-28 17:23:54.886524
serverchanKey	SCT327273TZVWI3LyXNGJ1t5BRVVvm8oPR	2026-03-26 12:34:50.051109	2026-03-26 12:46:20.775633
\.


--
-- Data for Name: daily_profits; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.daily_profits (id, date, stock_today, fund_today, total_today, created_at) FROM stdin;
1	2026-03-24	-4146.00	-424.00	-8410.00	2026-03-26 12:46:20.509697
2	2026-03-25	4146.00	4331.00	8476.00	2026-03-26 12:46:20.689164
3	2026-03-26	-3960.00	-4456.00	-8416.00	2026-03-29 09:38:22.54661
7	2026-03-27	82.00	-180.00	-97.00	2026-03-27 15:00:03.951495
10	2026-03-28	-169.00	0.00	-169.00	2026-03-28 15:00:01.641261
13	2026-03-29	-169.00	0.00	-169.00	2026-03-29 15:24:49.530694
21	2026-03-30	-1544.00	-1300.00	-2844.00	2026-03-30 15:30:14.355015
23	2026-03-06	0.00	0.00	0.00	2026-03-30 15:50:12.81406
24	2026-03-31	-1362.00	-3207.00	-4570.00	2026-03-31 15:00:01.958926
27	2026-04-01	3406.00	6189.00	9596.00	2026-04-01 15:00:03.416055
29	2026-04-02	-3720.00	-3138.00	-6858.00	2026-04-02 15:00:03.222972
31	2026-04-03	-3258.00	-1464.00	-4722.00	2026-04-03 15:00:02.188611
33	2026-04-06	-3638.00	0.00	-3638.00	2026-04-06 15:00:03.66693
34	2026-04-07	-3389.00	575.00	-2815.00	2026-04-07 15:00:02.255201
35	2026-04-08	8816.00	10990.00	19806.00	2026-04-08 15:00:02.12643
37	2026-04-09	-3590.00	-2854.00	-6444.00	2026-04-09 15:00:01.868488
38	2026-04-10	1826.00	2273.00	4098.00	2026-04-10 15:00:01.461461
40	2026-04-13	1826.00	0.00	1826.00	2026-04-13 01:25:33.649304
41	2026-04-14	1461.00	2046.00	3507.00	2026-04-14 15:00:01.367814
42	2026-04-15	3935.00	1266.00	5201.00	2026-04-15 15:00:02.761045
44	2026-04-16	8730.00	6353.00	15083.00	2026-04-16 15:00:06.95944
46	2026-04-17	-548.00	-1255.00	-1803.00	2026-04-17 15:00:03.010197
49	2026-04-20	1435.00	1117.00	2552.00	2026-04-20 15:00:02.561305
50	2026-04-21	-1069.00	253.00	-816.00	2026-04-21 15:00:02.074142
51	2026-04-22	1435.00	0.00	1435.00	2026-04-22 15:00:01.221992
55	2026-04-23	-2170.00	-3161.00	-5330.00	2026-04-23 15:00:02.859592
56	2026-04-24	413.00	-103.00	310.00	2026-04-24 15:00:02.815418
4	2026-05-10	0.00	0.00	0.00	2026-05-11 14:08:29.505014
6	2026-05-11	-3583.00	1600.00	-1983.00	2026-05-12 00:04:41.213765
\.


--
-- Data for Name: pending_trades; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.pending_trades (id, row_id, code, name, amount, is_before_15, created_at, type, shares) FROM stdin;
1774743158386t4vtbrbee-1778484572	1774743158386t4vtbrbee	019924	华泰柏瑞中证2000指数增强C	2825.68	t	2026-05-11 07:29:32	reduce	1300.0000
1774356978871gohpbk0uv-1778484585	1774356978871gohpbk0uv	016531	鹏华碳中和主题混合C	2063.06	t	2026-05-11 07:29:45	reduce	1042.0000
17742708955447v85htgpo-1778502531	17742708955447v85htgpo	013309	易方达恒生科技ETF联接(QDII)C	1.00	t	2026-05-11 12:28:51	add	0.8318
\.


--
-- Data for Name: positions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.positions (id, code, name, shares, cost, is_fund, is_overseas, plan_buy, alert, target_price, created_at, updated_at, category_id) FROM stdin;
513120-1778510499	513120	港股创新药ETF广发	8800.0000	1.2310	f	f	0.00	\N	\N	2026-05-11 22:41:39.509315	2026-05-11 22:42:25.594729	cxy
1774198708865v00xywl0e	09988	阿里巴巴-W	700.0000	141.6380	f	f	10000.00	\N	185.0000	2026-03-26 12:46:16.520834	2026-05-11 22:21:32.52756	hk_stock
17743570908215j8aiqrve	017145	华宝海外新能源汽车股票发起式(QDII)C	0.0000	1.6191	t	t	0.00	\N	\N	2026-03-26 12:46:18.901317	2026-05-11 10:38:56.368755	\N
17762542890386zy8yohio	513330	恒生互联网ETF华夏	49100.0000	0.8670	f	f	0.00	\N	0.6240	2026-04-15 11:59:16.418678	2026-05-11 22:21:45.321552	hk_stock
17752628917806enmbxu9l	09626	哔哩哔哩-W	80.0000	184.7040	f	f	0.00	\N	280.0000	2026-04-04 00:36:10.963317	2026-05-11 22:21:57.501497	hk_stock
1774432392200ul5es8ctm	01810	小米集团-W	400.0000	36.3290	f	f	0.00	\N	50.0000	2026-03-26 12:46:19.072647	2026-05-11 22:22:03.874012	hk_stock
501205-1778513125	501205	鹏华创新未来混合(LOF)C	2005.0000	0.9975	t	f	0.00	\N	\N	2026-05-11 23:25:25.20104	2026-05-11 23:26:08.165883	cpo
512480-1778469129	512480	半导体ETF国联安	6100.0000	1.8530	f	f	0.00	\N	\N	2026-05-11 11:12:09.374705	2026-05-12 07:01:07.483811	bdt
17742708955447v85htgpo	013309	易方达恒生科技ETF联接(QDII)C	100933.4500	1.2875	t	f	49000.00	\N	1.5700	2026-03-26 12:46:16.875359	2026-05-11 22:22:52.302805	hk_stock
1774270895544lgga0vhjp	009052	易方达中证红利ETF联接C	26009.3000	1.2688	t	f	0.00	\N	\N	2026-03-26 12:46:17.853023	2026-05-11 22:22:58.994426	hongli
1774270895544w05c6cr36	021458	易方达恒生红利低波ETF联接C	23614.0300	1.2916	t	f	0.00	\N	\N	2026-03-26 12:46:17.047118	2026-05-11 22:23:04.551916	hongli
1774447063409e24n6vvrn	023918	华夏国证自由现金流ETF发起式联接C	22997.7100	1.2996	t	f	0.00	\N	\N	2026-03-26 12:46:19.244156	2026-05-11 22:23:12.906055	hongli
17742708955448a6tud72l	023754	永赢信息产业智选混合发起C	13870.0000	1.0814	t	f	10000.00	\N	\N	2026-03-26 12:46:17.220344	2026-05-11 22:24:33.058036	aiyingyong
1774743158386t4vtbrbee	019924	华泰柏瑞中证2000指数增强C	5199.0900	1.8791	t	f	0.00	\N	\N	2026-03-29 00:15:55.294404	2026-05-11 22:24:38.724598	index_fund
1774356762203j6edrqb2p	020501	广发中证港股通非银ETF发起式联接C	6340.0000	1.5773	t	f	10000.00	\N	\N	2026-03-26 12:46:18.213015	2026-05-11 22:24:44.146018	cxy
17742708955449tahbb040	018125	永赢先进制造智选混合发起C	4059.9900	2.4630	t	f	3000.00	\N	\N	2026-03-26 12:46:17.390132	2026-05-11 22:24:50.841977	jiqiren
159545-1778540606	159545	恒生红利低波ETF易方达	24100.0000	1.4340	f	f	0.00	\N	\N	2026-05-12 07:03:26.464092	2026-05-12 07:03:26.464092	hongli
510210-1778540663	510210	上证指数ETF富国	11400.0000	1.0880	f	f	0.00	\N	\N	2026-05-12 07:04:23.727363	2026-05-12 07:04:23.727363	index_fund
1776254400069e7r5zs6b1	513770	港股互联网ETF华宝	95000.0000	0.5030	f	f	0.00	\N	0.6600	2026-04-15 12:01:40.689727	2026-05-11 22:16:17.004407	hk_stock
1774270895544vq2i00gn9	019671	广发中证香港创新药ETF发起式联接(QDII)C	6871.0000	1.3130	t	f	10000.00	\N	\N	2026-03-26 12:46:18.025546	2026-05-11 22:24:58.631827	cxy
1774356978871gohpbk0uv	016531	鹏华碳中和主题混合C	4168.1800	1.8553	t	f	4000.00	\N	\N	2026-03-26 12:46:18.555156	2026-05-11 22:25:05.056961	jiqiren
1774743653207yp7qcd9xv	013286	富国上证指数ETF联接C	3906.3100	1.9196	t	f	0.00	\N	\N	2026-03-29 00:21:54.01862	2026-05-11 22:25:11.035026	index_fund
1774200020851nj0pmxz8s	011861	南方中证1000ETF发起联接C	6386.4500	1.0999	t	f	50000.00	\N	\N	2026-03-26 12:46:16.703609	2026-05-11 22:25:15.319275	index_fund
1774454602802jc2nkmngg	015968	永赢半导体产业智选混合发起C	2449.3400	1.6382	t	f	0.00	\N	\N	2026-03-26 12:46:19.704889	2026-05-11 22:25:20.964435	bdt
177635819385070id17bxy	018463	德邦稳盈增长灵活配置混合C	2912.1300	1.0303	t	f	0.00	\N	\N	2026-04-16 16:51:10.339306	2026-05-11 22:25:27.201382	aiyingyong
1774774397336grynixpj6	515230	软件ETF国泰	15200.0000	1.0020	f	f	0.00	\N	\N	2026-03-29 08:54:00.878667	2026-05-11 22:26:05.296615	aiyingyong
17750501713666uzncurhz	022751	南方中证港股通汽车产业主题ETF发起联接C	4000.0000	1.2807	t	f	0.00	\N	\N	2026-04-01 13:30:14.54824	2026-05-11 22:34:21.82869	hk_stock
159201-1778540710	159201	自由现金流ETF华夏	7400.0000	1.3180	f	f	0.00	\N	\N	2026-05-12 07:05:10.78761	2026-05-12 07:05:10.78761	hongli
515450-1778540763	515450	红利低波50ETF南方	6800.0000	1.4340	f	f	0.00	\N	\N	2026-05-12 07:06:04.023563	2026-05-12 07:06:04.023563	hongli
563300-1778481759	563300	中证2000ETF华泰柏瑞	4800.0000	1.2820	f	f	0.00	\N	\N	2026-05-11 14:42:39.452695	2026-05-12 07:06:24.408563	index_fund
\.


--
-- Data for Name: trade_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.trade_history (id, row_id, type, amount, shares, net_value, is_before_15, created_at, local_date) FROM stdin;
1774530991614vhd7jupdq	1774454602802jc2nkmngg	add	1000.00	620.0800	1.6127	t	2026-03-26 13:16:31.614	2026-03-26
1774890672359k7vykwgei	17742708955447v85htgpo	add	2000.00	1804.4000	1.1084	t	2026-03-30 17:11:12.359	2026-03-30
1775007203032etu5fgdm8	17742708955447v85htgpo	add	2000.00	1804.4000	1.1084	t	2026-04-01 01:33:23.032	\N
17750872887039wddopprn	17742708955447v85htgpo	add	2000.00	1770.6900	1.1295	t	2026-04-01 23:48:08.703	\N
177508746947737van8pjb	1774356762203j6edrqb2p	reduce	2584.85	1700.0000	1.5205	t	2026-04-01 23:51:09.477	\N
1775088205245t2auqz7sf	1774270895544vq2i00gn9	reduce	2301.29	1700.0000	1.3537	t	2026-04-02 00:03:25.245	2026-04-02
17750886405056cm3h7trr	17743570908215j8aiqrve	reduce	1.50	1.0000	1.4972	t	2026-04-02 00:10:40.505	\N
1775088690377y8cgcqkv2	17743570908215j8aiqrve	reduce	1.50	1.0000	1.4972	t	2026-04-02 00:11:30.377	\N
1775090697460vly9mmpxg	1774270895544vq2i00gn9	reduce	1.35	1.0000	1.3537	t	2026-04-02 00:44:57.46	\N
1775092607035nw7b07v3p	17742708955447v85htgpo	add	2000.00	1801.3100	1.1103	t	2026-04-02 01:16:47.035	2026-04-02
17752988869847y8qimive	17742708955447v85htgpo	add	1.00	0.9000	1.1103	t	2026-04-03 10:34:46.984	2026-04-03
1775299351369a9g6n8fs7	17742708955447v85htgpo	add	1.00	0.9000	1.1103	t	2026-04-03 10:42:31.369	2026-04-03
1775820350669trg56nyq0	1774200020851nj0pmxz8s	reduce	10897.91	10090.6600	1.0800	t	2026-04-10 11:25:50.49	2026-04-10
17758219891980i0vy1bo7	1774743653207yp7qcd9xv	reduce	1.95	1.0000	1.9450	t	2026-04-10 11:53:07.33	2026-04-10
1776058255397wjimkaa5k	1774270895544w05c6cr36	add	5000.00	3937.3200	1.2699	t	2026-04-13 05:30:55.397	2026-04-13
17760582717053t4afmzor	17742708955447v85htgpo	add	1000.00	876.3500	1.1411	t	2026-04-13 05:31:11.705	2026-04-13
1776147444033aeoljvqlb	17742708955447v85htgpo	add	1000.00	871.8400	1.1470	t	2026-04-14 06:17:24.033	2026-04-14
1776147472767pwd3nw8qh	1774270895544w05c6cr36	add	1000.00	785.4800	1.2731	t	2026-04-14 06:17:52.767	2026-04-14
1776147503800kr4twiuhr	1774270895544lgga0vhjp	add	3000.00	2357.3800	1.2726	t	2026-04-14 06:18:23.8	2026-04-14
17762540022589ojxngbvk	17742708955447v85htgpo	add	1000.00	862.2200	1.1598	t	2026-04-15 11:53:22.258	2026-04-15
1776254028941ob9uwusfm	1774200020851nj0pmxz8s	reduce	5519.41	5046.0900	1.0938	t	2026-04-15 11:53:48.941	2026-04-15
1776254061724jmvubar5q	1774447063409e24n6vvrn	add	3000.00	2285.0200	1.3129	t	2026-04-15 11:54:21.724	2026-04-15
1776266411161bzb6w3eou	17742708955449tahbb040	add	1000.00	447.9100	2.2326	t	2026-04-15 15:20:11.161	2026-04-15
1776321464172rhc7ro3ru	1774447063409e24n6vvrn	add	3000.00	2267.5700	1.3230	t	2026-04-16 06:37:44.172	2026-04-16
1776326237739kjsvfwtxz	1774447063409e24n6vvrn	add	4000.00	3044.1400	1.3140	t	2026-04-16 07:57:17.739	2026-04-16
1776686845495uwko38n7t	1774200020851nj0pmxz8s	reduce	4262.55	3784.5600	1.1263	t	2026-04-20 12:07:25.495	2026-04-20
1776686857744zih2dyyqe	1774743653207yp7qcd9xv	reduce	2584.69	1302.1100	1.9850	t	2026-04-20 12:07:37.744	2026-04-20
177668689087775v53w7r1	1774743158386t4vtbrbee	reduce	5348.79	2599.1500	2.0579	t	2026-04-20 12:08:10.877	2026-04-20
17766869097284fnum5hhw	1774356978871gohpbk0uv	add	1000.00	555.6800	1.7996	t	2026-04-20 12:08:29.728	2026-04-20
1776686919761r4wqczm88	17742708955449tahbb040	add	1000.00	445.0800	2.2468	t	2026-04-20 12:08:39.761	2026-04-20
17766869401278p3q1spgx	177635819385070id17bxy	add	2000.00	1909.1300	1.0476	t	2026-04-20 12:09:00.127	2026-04-20
1776761346623ip34lz9w3	1774200020851nj0pmxz8s	reduce	3194.64	2838.4200	1.1255	t	2026-04-21 08:49:06.623	2026-04-21
1776869249492q6i70myhy	17742708955447v85htgpo	add	1000.00	853.1000	1.1722	t	2026-04-22 14:47:29.492	2026-04-22
17768692960259k864go8p	1774200020851nj0pmxz8s	reduce	2431.75	2128.8200	1.1423	t	2026-04-22 14:48:16.025	2026-04-22
1776869327642in9bso0mw	1774454602802jc2nkmngg	reduce	2336.20	1224.4900	1.9079	t	2026-04-22 14:48:47.642	2026-04-22
177695512308699leicq0e	17742708955447v85htgpo	add	1000.00	869.3400	1.1503	t	2026-04-23 14:38:43.086	2026-04-23
1774270895544lgga0vhjp-1778467472	1774270895544lgga0vhjp	add	1.00	0.7800	1.2887	t	2026-05-11 02:44:32	\N
\.


--
-- Name: Record_id_seq; Type: SEQUENCE SET; Schema: public; Owner: yangyang
--

SELECT pg_catalog.setval('public."Record_id_seq"', 1, true);


--
-- Name: asset_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_records_id_seq', 27, true);


--
-- Name: daily_profits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.daily_profits_id_seq', 8, true);


--
-- Name: Record Record_pkey; Type: CONSTRAINT; Schema: public; Owner: yangyang
--

ALTER TABLE ONLY public."Record"
    ADD CONSTRAINT "Record_pkey" PRIMARY KEY (id);


--
-- Name: alert_rules alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_pkey PRIMARY KEY (id);


--
-- Name: asset_records asset_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_records
    ADD CONSTRAINT asset_records_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: configs configs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.configs
    ADD CONSTRAINT configs_pkey PRIMARY KEY (key);


--
-- Name: daily_profits daily_profits_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_profits
    ADD CONSTRAINT daily_profits_date_key UNIQUE (date);


--
-- Name: daily_profits daily_profits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.daily_profits
    ADD CONSTRAINT daily_profits_pkey PRIMARY KEY (id);


--
-- Name: pending_trades pending_trades_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_trades
    ADD CONSTRAINT pending_trades_pkey PRIMARY KEY (id);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- Name: trade_history trade_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.trade_history
    ADD CONSTRAINT trade_history_pkey PRIMARY KEY (id);


--
-- Name: idx_alert_rules_enabled; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_alert_rules_enabled ON public.alert_rules USING btree (enabled);


--
-- Name: idx_alert_rules_position_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_alert_rules_position_id ON public.alert_rules USING btree (position_id);


--
-- Name: idx_asset_records_recorded_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_asset_records_recorded_at ON public.asset_records USING btree (recorded_at);


--
-- Name: idx_daily_profits_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_daily_profits_date ON public.daily_profits USING btree (date);


--
-- Name: idx_pending_trades_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pending_trades_created_at ON public.pending_trades USING btree (created_at);


--
-- Name: idx_pending_trades_row_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pending_trades_row_id ON public.pending_trades USING btree (row_id);


--
-- Name: idx_positions_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_positions_code ON public.positions USING btree (code);


--
-- Name: idx_positions_is_fund; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_positions_is_fund ON public.positions USING btree (is_fund);


--
-- Name: idx_trade_history_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trade_history_created_at ON public.trade_history USING btree (created_at);


--
-- Name: idx_trade_history_local_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trade_history_local_date ON public.trade_history USING btree (local_date);


--
-- Name: idx_trade_history_row_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trade_history_row_id ON public.trade_history USING btree (row_id);


--
-- Name: alert_rules alert_rules_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alert_rules
    ADD CONSTRAINT alert_rules_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id) ON DELETE CASCADE;


--
-- Name: pending_trades pending_trades_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_trades
    ADD CONSTRAINT pending_trades_row_id_fkey FOREIGN KEY (row_id) REFERENCES public.positions(id) ON DELETE CASCADE;


--
-- Name: trade_history trade_history_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.trade_history
    ADD CONSTRAINT trade_history_row_id_fkey FOREIGN KEY (row_id) REFERENCES public.positions(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict k28aPcK3JsKlGLCrGJe1Il7NloQqLFT7nL4pFeaYHn7GiCaZJw5fEd9At0Dg24G

