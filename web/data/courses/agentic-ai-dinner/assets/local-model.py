#!/usr/bin/env python3
"""Optional local Ollama extraction experiment. No remote service or ordering API."""
import argparse,json,time,urllib.request,urllib.error,sys
PROMPT='''Extract dinner preferences from the supplied request. Return JSON with exactly these fields: cuisine_preferences (list of strings or null), spice_preference (string or null), budget_amount (positive number or null), currency (string or null), includes_fees (boolean or null), dietary_restrictions (list of strings or null), delivery_area (string or null). Preserve explicit facts; do not guess missing values. Use null for unknown values and [] for dietary_restrictions only if the user explicitly says none. Do not recommend dishes or claim an order was placed.'''
def validate(data):
    if not isinstance(data,dict):return ['Expected a JSON object.']
    errors=[]
    fields=['cuisine_preferences','spice_preference','budget_amount','currency','includes_fees','dietary_restrictions','delivery_area']
    for field in fields:
        if field not in data:errors.append('Missing field: '+field)
    for field in ['cuisine_preferences','dietary_restrictions']:
        value=data.get(field)
        if value is not None and (not isinstance(value,list) or not all(isinstance(x,str) and x.strip() for x in value)):errors.append(field+' must be a string list or null.')
    for field in ['spice_preference','currency','delivery_area']:
        value=data.get(field)
        if value is not None and (not isinstance(value,str) or not value.strip()):errors.append(field+' must be a nonempty string or null.')
    amount=data.get('budget_amount')
    if amount is not None and (isinstance(amount,bool) or not isinstance(amount,(int,float)) or amount<=0):errors.append('budget_amount must be positive or null.')
    if data.get('includes_fees') is not None and not isinstance(data['includes_fees'],bool):errors.append('includes_fees must be boolean or null.')
    if set(data)-set(fields):errors.append('Unexpected fields present.')
    return errors

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',required=True,help='An already installed local Ollama model tag.')
    parser.add_argument('--request',default='Something spicy under 25 USD including fees. Thai would be nice.')
    args=parser.parse_args()
    body={'model':args.model,'messages':[{'role':'system','content':PROMPT},{'role':'user','content':args.request}],'stream':False,'format':'json','options':{'temperature':0}}
    req=urllib.request.Request('http://127.0.0.1:11434/api/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    start=time.perf_counter()
    try:
        with urllib.request.urlopen(req,timeout=120) as response:payload=json.load(response)
    except (urllib.error.URLError,TimeoutError) as error:
        print('Local model call failed. Check that Ollama is running and this model is installed. '+str(error),file=sys.stderr);return 1
    raw=payload.get('message',{}).get('content','')
    try:parsed=json.loads(raw);errors=validate(parsed)
    except json.JSONDecodeError:parsed=None;errors=['The model response was not valid JSON.']
    print(json.dumps({'scope':'Actual call to your local Ollama service; no ordering capability.','model':args.model,'elapsed_seconds':round(time.perf_counter()-start,3),'raw_response':raw,'parsed':parsed,'structure_errors':errors,'next_check':'Compare each value with the request. Structural validity does not establish semantic accuracy.'},indent=2))
    return 0 if not errors else 2
if __name__=='__main__':sys.exit(main())
